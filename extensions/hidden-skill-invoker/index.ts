import { readFile, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { parseFrontmatter, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const VALID_SKILL_NAME = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;

type Invocation = {
  skill: string;
  commandText: string;
  expandedText: string;
  continuation?: string;
};

async function hasDirectDelegation(pi: ExtensionAPI, targetName: string, targetPath: string): Promise<boolean> {
  const targetCommandName = `skill:${targetName}`;
  const targetCanonicalPath = await realpath(targetPath).catch(() => targetPath);
  const directReference = new RegExp(`/skill:${targetName}(?![a-z0-9-])`);
  const otherSkills = pi
    .getCommands()
    .filter((command) => command.source === "skill" && command.name !== targetCommandName);

  const references = await Promise.all(
    otherSkills.map(async (command) => {
      const canonicalPath = await realpath(command.sourceInfo.path).catch(() => command.sourceInfo.path);
      if (canonicalPath === targetCanonicalPath) return false;

      try {
        const { body } = parseFrontmatter(await readFile(command.sourceInfo.path, "utf8"));
        return directReference.test(body);
      } catch {
        return false;
      }
    }),
  );

  return references.some(Boolean);
}

export default function hiddenSkillInvoker(pi: ExtensionAPI) {
  const awaitingInput: Invocation[] = [];
  const awaitingTurn: Invocation[] = [];
  let activeInvocation: Invocation | undefined;

  pi.registerTool({
    name: "invoke_hidden_skill",
    label: "Invoke Hidden Skill",
    description:
      "Bridge delegation to any installed hidden skill that another installed SKILL.md directly references as /skill:<name>. " +
      "An optional continuation returns control to the delegating workflow after a read-only drafting run.",
    promptSnippet: "Delegate an exact /skill:<name> reference to an installed hidden skill",
    promptGuidelines: [
      "When an active workflow directly delegates with /skill:<name>, use invoke_hidden_skill as the bridge; the workflow does not need to name the tool.",
      "Use invoke_hidden_skill only for exact /skill:<name> references made by another installed SKILL.md.",
      "Supply invoke_hidden_skill continuation only when a drafting workflow must remain read-only and then return control to its adapter.",
    ],
    parameters: Type.Object({
      skill: Type.String({
        pattern: VALID_SKILL_NAME.source,
        description: "The installed hidden skill name, without /skill:.",
      }),
      input: Type.String({
        description: "Context and instructions appended to the hidden skill. Multiline text is supported.",
      }),
      continuation: Type.Optional(
        Type.String({
          minLength: 1,
          description: "Follow-up user message queued after a read-only drafting skill finishes.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      if (!VALID_SKILL_NAME.test(params.skill)) {
        throw new Error(
          `Invalid skill name "${String(params.skill)}". Use 1-64 lowercase letters, numbers, or single hyphens.`,
        );
      }

      const commandName = `skill:${params.skill}`;
      const command = pi
        .getCommands()
        .find((candidate) => candidate.name === commandName && candidate.source === "skill");
      if (!command) {
        throw new Error(
          `Hidden skill /${commandName} is unavailable. Ensure the skill is installed and Pi skill commands are enabled.`,
        );
      }

      let body: string;
      try {
        const parsed = parseFrontmatter<{
          name?: unknown;
          "disable-model-invocation"?: unknown;
        }>(await readFile(command.sourceInfo.path, "utf8"));
        if (parsed.frontmatter.name !== params.skill) {
          throw new Error(`frontmatter name is ${JSON.stringify(parsed.frontmatter.name)}`);
        }
        if (parsed.frontmatter["disable-model-invocation"] !== true) {
          throw new Error(
            `Skill /${commandName} is not hidden. Its SKILL.md must set disable-model-invocation: true.`,
          );
        }
        body = parsed.body.trim();
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`Skill /${commandName} is not hidden.`)) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Hidden skill /${commandName} could not be loaded from its verified skill command: ${message}`);
      }

      if (!(await hasDirectDelegation(pi, params.skill, command.sourceInfo.path))) {
        throw new Error(
          `Hidden skill /${commandName} is not directly delegated by another installed skill. ` +
            `Add the exact /${commandName} reference to the delegating SKILL.md.`,
        );
      }

      const commandText = params.input ? `/${commandName} ${params.input}` : `/${commandName}`;
      const baseDir = command.sourceInfo.baseDir ?? dirname(command.sourceInfo.path);
      const skillBlock =
        `<skill name="${params.skill}" location="${command.sourceInfo.path}">\n` +
        `References are relative to ${baseDir}.\n\n${body}\n</skill>`;
      const expandedText = params.input ? `${skillBlock}\n\n${params.input}` : skillBlock;
      const invocation: Invocation = {
        skill: params.skill,
        commandText,
        expandedText,
        continuation: params.continuation,
      };

      // Pi 0.80's sendUserMessage intentionally skips slash-command expansion.
      // The input hook below expands only the exact, already verified command queued here.
      awaitingInput.push(invocation);
      pi.sendUserMessage(commandText, { deliverAs: "followUp" });

      return {
        content: [{ type: "text", text: `Queued hidden skill: ${params.skill}.` }],
        details: { skill: params.skill },
      };
    },
  });

  pi.on("input", async (event) => {
    if (event.source !== "extension") return { action: "continue" };

    const invocationIndex = awaitingInput.findIndex((invocation) => invocation.commandText === event.text);
    if (invocationIndex === -1) return { action: "continue" };

    const [invocation] = awaitingInput.splice(invocationIndex, 1);
    awaitingTurn.push(invocation);
    return { action: "transform", text: invocation.expandedText };
  });

  pi.on("turn_start", () => {
    const invocation = awaitingTurn.shift();
    if (invocation) activeInvocation = invocation;
  });

  pi.on("tool_call", (event) => {
    if (activeInvocation?.continuation === undefined || READ_ONLY_TOOLS.has(event.toolName)) return;

    return {
      block: true,
      reason:
        `Hidden skill ${activeInvocation.skill} has a continuation; ` +
        `side-effecting tool ${event.toolName} is blocked.`,
    };
  });

  pi.on("agent_settled", () => {
    const completed = activeInvocation;
    activeInvocation = undefined;
    if (completed?.continuation) {
      pi.sendUserMessage(completed.continuation, { deliverAs: "followUp" });
    }
  });

  pi.on("session_shutdown", () => {
    awaitingInput.length = 0;
    awaitingTurn.length = 0;
    activeInvocation = undefined;
  });
}

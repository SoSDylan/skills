import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import hiddenSkillInvoker from "../index.ts";

function command(name, path, source = "skill") {
  return {
    name: `skill:${name}`,
    source,
    sourceInfo: {
      path,
      source: `skill:${name}`,
      scope: "user",
      origin: "top-level",
      baseDir: join(path, ".."),
    },
  };
}

function harness(commands = []) {
  const handlers = new Map();
  const sent = [];
  let tool;

  const pi = {
    getCommands: () => commands,
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerTool(definition) {
      tool = definition;
    },
    sendUserMessage(text, options) {
      sent.push({ text, options });
    },
  };

  hiddenSkillInvoker(pi);

  return {
    get tool() {
      return tool;
    },
    sent,
    async emit(event, payload = {}) {
      let result;
      for (const handler of handlers.get(event) ?? []) {
        const next = await handler(payload, {});
        if (next !== undefined) result = next;
      }
      return result;
    },
  };
}

async function skillFile(name, body = `# ${name}\n\nHidden workflow.`, hidden = true) {
  const dir = await mkdtemp(join(tmpdir(), "hidden-skill-invoker-"));
  const path = join(dir, "SKILL.md");
  await writeFile(
    path,
    `---\nname: ${name}\ndescription: test\ndisable-model-invocation: ${hidden}\n---\n\n${body}\n`,
  );
  return path;
}

const execute = (tool, params) => tool.execute("call-1", params, undefined, undefined, {});

test("queues any hidden skill directly referenced by another skill with multiline Unicode context", async () => {
  const path = await skillFile("custom-private-workflow");
  const adapterPath = await skillFile("custom-adapter", "# Adapter\n\nDelegate to `/skill:custom-private-workflow`.");
  const app = harness([
    command("custom-private-workflow", path),
    command("custom-adapter", adapterPath),
  ]);
  const input = "Card: Ship it 🚀\n\nFirst line\nSecond line";

  const result = await execute(app.tool, { skill: "custom-private-workflow", input });

  assert.deepEqual(app.sent, [
    {
      text: `/skill:custom-private-workflow ${input}`,
      options: { deliverAs: "followUp" },
    },
  ]);
  assert.equal(result.content[0].text, "Queued hidden skill: custom-private-workflow.");
});

test("rejects hidden skills not directly referenced with /skill:<name>", async (t) => {
  const targetPath = await skillFile("private-workflow");

  await t.test("unreferenced", async () => {
    const app = harness([command("private-workflow", targetPath)]);
    await assert.rejects(
      execute(app.tool, { skill: "private-workflow", input: "do it" }),
      /not directly delegated.*\/skill:private-workflow/i,
    );
    assert.deepEqual(app.sent, []);
  });

  await t.test("shorthand reference", async () => {
    const adapterPath = await skillFile("adapter", "# Adapter\n\nDelegate to `/private-workflow`.");
    const app = harness([
      command("private-workflow", targetPath),
      command("adapter", adapterPath),
    ]);
    await assert.rejects(
      execute(app.tool, { skill: "private-workflow", input: "do it" }),
      /not directly delegated.*\/skill:private-workflow/i,
    );
    assert.deepEqual(app.sent, []);
  });

  await t.test("self-reference", async () => {
    const selfPath = await skillFile("self-workflow", "# Self\n\nCall `/skill:self-workflow`.");
    const app = harness([command("self-workflow", selfPath)]);
    await assert.rejects(
      execute(app.tool, { skill: "self-workflow", input: "do it" }),
      /not directly delegated.*\/skill:self-workflow/i,
    );
    assert.deepEqual(app.sent, []);
  });
});

test("rejects visible skills and invalid names without queueing", async (t) => {
  await t.test("visible skill", async () => {
    const path = await skillFile("visible-workflow", "# Visible", false);
    const app = harness([command("visible-workflow", path)]);
    await assert.rejects(
      execute(app.tool, { skill: "visible-workflow", input: "do it" }),
      /not hidden.*disable-model-invocation/i,
    );
    assert.deepEqual(app.sent, []);
  });

  await t.test("invalid name", async () => {
    const app = harness([]);
    await assert.rejects(execute(app.tool, { skill: "../arbitrary", input: "do it" }), /invalid skill name/i);
    assert.deepEqual(app.sent, []);
  });
});

test("rejects missing and non-skill commands without queueing", async (t) => {
  await t.test("missing", async () => {
    const app = harness([]);
    await assert.rejects(execute(app.tool, { skill: "to-spec", input: "draft" }), /skill:to-spec.*unavailable/i);
    assert.deepEqual(app.sent, []);
  });

  await t.test("wrong provenance", async () => {
    const path = await skillFile("to-spec");
    const app = harness([command("to-spec", path, "prompt")]);
    await assert.rejects(execute(app.tool, { skill: "to-spec", input: "draft" }), /skill:to-spec.*unavailable/i);
    assert.deepEqual(app.sent, []);
  });
});

test("expands the verified queued slash command for extension-originated input", async () => {
  const path = await skillFile("implement", "# Implement\n\nRun the hidden workflow.");
  const adapterPath = await skillFile("adapter", "# Adapter\n\nDelegate to `/skill:implement`.");
  const app = harness([command("implement", path), command("adapter", adapterPath)]);
  const input = "Card body line 1\nCard body line 2";
  await execute(app.tool, { skill: "implement", input });

  const transformed = await app.emit("input", {
    text: `/skill:implement ${input}`,
    source: "extension",
    streamingBehavior: "followUp",
  });

  assert.equal(transformed.action, "transform");
  assert.match(transformed.text, /^<skill name="implement" location=".*SKILL\.md">/);
  assert.match(transformed.text, /# Implement\n\nRun the hidden workflow\.\n<\/skill>/);
  assert.ok(transformed.text.endsWith(`\n\n${input}`));
  assert.doesNotMatch(transformed.text, /disable-model-invocation/);
});

test("draft-only invocation blocks side-effecting tools, then queues its continuation", async () => {
  const path = await skillFile("to-spec");
  const adapterPath = await skillFile("adapter", "# Adapter\n\nDelegate to `/skill:to-spec`.");
  const app = harness([command("to-spec", path), command("adapter", adapterPath)]);
  await execute(app.tool, {
    skill: "to-spec",
    input: "Return markdown only.",
    mode: "draft-only",
    continuation: "Resume the Trello adapter at canonical-file validation.",
  });
  await app.emit("input", {
    text: "/skill:to-spec Return markdown only.",
    source: "extension",
    streamingBehavior: "followUp",
  });

  await app.emit("turn_start", {});

  assert.deepEqual(await app.emit("tool_call", { toolName: "read" }), undefined);
  assert.deepEqual(await app.emit("tool_call", { toolName: "bash" }), {
    block: true,
    reason: "Hidden skill to-spec is running in draft-only mode; side-effecting tool bash is blocked.",
  });
  assert.deepEqual(await app.emit("tool_call", { toolName: "invoke_hidden_skill" }), {
    block: true,
    reason: "Hidden skill to-spec is running in draft-only mode; side-effecting tool invoke_hidden_skill is blocked.",
  });

  await app.emit("agent_end", {});

  assert.deepEqual(app.sent.at(-1), {
    text: "Resume the Trello adapter at canonical-file validation.",
    options: { deliverAs: "followUp" },
  });
  assert.equal(await app.emit("tool_call", { toolName: "bash" }), undefined);
});

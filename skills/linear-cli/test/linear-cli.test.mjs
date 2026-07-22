import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LinearClient,
  parseArguments,
  parseIssueReference,
} from "../scripts/linear-cli.mjs";

const CLI = new URL("../scripts/linear-cli.mjs", import.meta.url).pathname;

async function withGraphqlServer(t, handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push({ ...payload, authorization: request.headers.authorization });
    const result = await handler(payload, requests);
    response.statusCode = result.statusCode ?? 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result.body ?? { data: result.data }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  return {
    client: new LinearClient({ apiKey: "secret-key", apiUrl: `http://127.0.0.1:${port}/graphql` }),
    requests,
  };
}

function issue(overrides = {}) {
  return {
    id: "issue-id",
    identifier: "WEB-123",
    title: "Test issue",
    team: { id: "team-id", key: "WEB", name: "Web" },
    state: { id: "todo-id", name: "Todo", type: "unstarted" },
    project: { id: "project-id", name: "Feature" },
    ...overrides,
  };
}

test("runs when invoked through a symlinked skill directory", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linear-cli-symlink-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const skillLink = path.join(directory, "linear-cli");
  await symlink(path.resolve(path.dirname(CLI), ".."), skillLink, "dir");

  const result = spawnSync(
    process.execPath,
    [path.join(skillLink, "scripts", "linear-cli.mjs"), "--help"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /linear-cli — Linear issue operations/);
  assert.equal(result.stderr, "");
});

test("parses issue identifiers and canonical Linear URLs", () => {
  assert.equal(parseIssueReference("web-123"), "WEB-123");
  assert.equal(parseIssueReference("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(
    parseIssueReference("https://linear.app/crewtraka/issue/WEB-123/test-issue?tab=activity"),
    "WEB-123",
  );
  assert.throws(() => parseIssueReference("https://evil.example/crewtraka/issue/WEB-123"), /linear\.app/);
  assert.throws(() => parseIssueReference("https://linear.app/crewtraka/project/WEB-123"), /\/issue\//);
});

test("parses positional arguments, values, and booleans", () => {
  assert.deepEqual(
    parseArguments(["search", "expense", "import", "--team", "WEB", "--all"]),
    { command: "search", positionals: ["expense", "import"], options: { team: "WEB", all: true } },
  );
  assert.throws(() => parseArguments(["list", "--team"]), /requires a value/);
});

test("get paginates complete issue connections", async (t) => {
  const { client, requests } = await withGraphqlServer(t, ({ query, variables }) => {
    if (query.includes("query IssueCore")) return { data: { issue: issue({ description: "Full body" }) } };
    if (query.includes("query IssueConnection")) {
      const field = ["comments", "labels", "children", "attachments", "relations", "inverseRelations"]
        .find((name) => query.includes(`${name}(first:`));
      if (field === "comments" && !variables.after) {
        return { data: { issue: { comments: {
          nodes: [{ id: "comment-1", body: "First" }],
          pageInfo: { hasNextPage: true, endCursor: "next-comment" },
        } } } };
      }
      const nodes = field === "comments" ? [{ id: "comment-2", body: "Second" }] : [];
      return { data: { issue: { [field]: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } };
    }
    throw new Error("Unexpected query");
  });

  const result = await client.get("https://linear.app/crewtraka/issue/WEB-123/test");

  assert.equal(result.identifier, "WEB-123");
  assert.deepEqual(result.comments.map((comment) => comment.id), ["comment-1", "comment-2"]);
  assert.equal(requests.filter((request) => request.query.includes("query IssueConnection")).length, 7);
  assert.equal(requests.every((request) => request.authorization === "secret-key"), true);
  assert.equal(JSON.stringify(requests).includes("LINEAR_API_KEY"), false);
});

test("create resolves names to IDs before mutation", async (t) => {
  let createInput;
  const { client } = await withGraphqlServer(t, ({ query, variables }) => {
    if (query.includes("query ResolveTeam")) {
      return { data: { teams: { nodes: [{ id: "team-id", key: "WEB", name: "Web" }] } } };
    }
    if (query.includes("query ResolveProject")) {
      return { data: { projects: { nodes: [{ id: "project-id", name: "Feature", teams: { nodes: [{ id: "team-id" }] } }] } } };
    }
    if (query.includes("query ResolveState")) {
      return { data: { workflowStates: { nodes: [{ id: "state-id", name: "Todo", type: "unstarted" }] } } };
    }
    if (query.includes("query Labels")) {
      return { data: { issueLabels: { nodes: [{
        id: "label-id", name: "Bug", isGroup: false, retiredAt: null,
        team: { id: "team-id", key: "WEB", name: "Web" }, parent: null,
      }] } } };
    }
    if (query.includes("mutation CreateIssue")) {
      createInput = variables.input;
      return { data: { issueCreate: { success: true, issue: issue() } } };
    }
    throw new Error("Unexpected query");
  });

  const result = await client.create({
    team: "WEB",
    title: "Create me",
    description: "Description",
    project: "Feature",
    state: "Todo",
    labels: "Bug",
    priority: "2",
    due: "2026-03-01",
  });

  assert.equal(result.success, true);
  assert.deepEqual(createInput, {
    description: "Description",
    title: "Create me",
    teamId: "team-id",
    projectId: "project-id",
    stateId: "state-id",
    labelIds: ["label-id"],
    priority: 2,
    dueDate: "2026-03-01",
  });
});

test("complete resolves the team's unique completed state", async (t) => {
  let updateInput;
  const { client } = await withGraphqlServer(t, ({ query, variables }) => {
    if (query.includes("query IssueCore")) return { data: { issue: issue() } };
    if (query.includes("query ResolveState")) {
      assert.deepEqual(variables.filter, { team: { id: { eq: "team-id" } }, type: { eq: "completed" } });
      return { data: { workflowStates: { nodes: [{ id: "done-id", name: "Done", type: "completed" }] } } };
    }
    if (query.includes("mutation TerminalState")) {
      updateInput = variables.input;
      return { data: { issueUpdate: { success: true, issue: issue({ state: { id: "done-id", name: "Done", type: "completed" } }) } } };
    }
    throw new Error("Unexpected query");
  });

  const result = await client.terminalState("WEB-123", "completed");
  assert.equal(result.success, true);
  assert.deepEqual(updateInput, { stateId: "done-id" });
});

test("reports API errors without exposing credentials", async (t) => {
  const { client } = await withGraphqlServer(t, () => ({
    body: { errors: [{ message: "Permission denied" }] },
  }));
  await assert.rejects(() => client.viewer(), (error) => {
    assert.match(error.message, /Permission denied/);
    assert.equal(error.message.includes("secret-key"), false);
    return true;
  });
});

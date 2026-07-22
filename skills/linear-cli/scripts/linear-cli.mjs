#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_API_URL = "https://api.linear.app/graphql";
const API_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;

const SUMMARY_FIELDS = `
  id identifier title priority priorityLabel estimate dueDate url
  createdAt updatedAt completedAt canceledAt archivedAt
  team { id key name }
  state { id name type }
  project { id name url }
  assignee { id name email }
`;

const HELP = `linear-cli — Linear issue operations through the GraphQL API

Authentication: set LINEAR_API_KEY.

Read commands:
  auth
  teams
  states --team <key|name|uuid>
  labels [--team <key|name|uuid>] [--group <name>]
  projects [--team <key|name|uuid>]
  list --team <key|name|uuid> [--all] [--limit <1-250>]
  search <text> [--team <key|name|uuid>] [--all] [--limit <1-250>]
  get <identifier|uuid|Linear issue URL>

Write commands (run only for an explicit user request):
  create --team <team> --title <title> [--description <md>|--description-file <path>]
         [--project <name|uuid>] [--state <name|uuid>] [--assignee <me|name|email|uuid>]
         [--labels <name,...>] [--priority <0-4>] [--due <YYYY-MM-DD>] [--parent <issue>]
  update <issue> [the same optional fields as create]
  comment <issue> (--body <md>|--body-file <path>)
  add-label <issue> --label <name|uuid>
  remove-label <issue> --label <name|uuid>
  triage <issue> --label <child-label> [--group <label-group>]
  complete <issue> [--state <completed-state>]
  cancel <issue> [--state <canceled-state>]
  relate <issue> --to <issue> --type <blocks|related|duplicate|similar>

Use the literal value "none" to clear project, assignee, due date, or parent on update.
All output is JSON: {"ok":true,"data":...} or {"ok":false,...}.`;

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function output(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

function fail(error) {
  const code = error instanceof CliError ? error.code : "ERROR";
  output({ ok: false, code, error: error.message }, 1);
}

export function parseIssueReference(value) {
  const input = String(value ?? "").trim();
  if (!input) throw new CliError("USAGE_ERROR", "An issue identifier, UUID, or Linear issue URL is required.");
  if (!input.includes("://")) {
    return /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(input) ? input.toUpperCase() : input;
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new CliError("USAGE_ERROR", "Invalid Linear issue URL.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "linear.app") {
    throw new CliError("USAGE_ERROR", "Expected an HTTPS linear.app issue URL.");
  }
  const match = url.pathname.match(/^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/|$)/);
  if (!match) throw new CliError("USAGE_ERROR", "Linear URL must contain /<workspace>/issue/<identifier>.");
  return match[1].toUpperCase();
}

export function parseArguments(argv) {
  const command = argv[0];
  const positionals = [];
  const options = {};
  const booleanOptions = new Set(["all", "help"]);

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!name) throw new CliError("USAGE_ERROR", "Invalid empty option.");
    if (booleanOptions.has(name)) {
      options[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError("USAGE_ERROR", `Option --${name} requires a value.`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, positionals, options };
}

function required(value, label) {
  if (value === undefined || String(value).trim() === "") {
    throw new CliError("USAGE_ERROR", `${label} is required.`);
  }
  return value;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function exactOne(nodes, kind, reference) {
  if (nodes.length === 0) throw new CliError("NOT_FOUND", `${kind} not found: ${reference}`);
  if (nodes.length > 1) {
    const choices = nodes.map((node) => node.key ? `${node.key} (${node.name})` : node.name || node.email || node.id);
    throw new CliError("AMBIGUOUS", `${kind} is ambiguous: ${reference}. Matches: ${choices.join(", ")}`);
  }
  return nodes[0];
}

function limitOption(value) {
  if (value === undefined) return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
    throw new CliError("USAGE_ERROR", "--limit must be an integer from 1 to 250.");
  }
  return limit;
}

function priorityOption(value) {
  if (value === undefined) return undefined;
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new CliError("USAGE_ERROR", "--priority must be an integer from 0 to 4.");
  }
  return priority;
}

function dueDateOption(value) {
  if (value === undefined) return undefined;
  if (value.toLowerCase() === "none") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new CliError("USAGE_ERROR", "--due must be YYYY-MM-DD or none.");
  }
  return value;
}

function connectionFilter(teamId, includeClosed) {
  const filter = teamId ? { team: { id: { eq: teamId } } } : {};
  if (!includeClosed) filter.state = { type: { nin: ["completed", "canceled", "duplicate"] } };
  return filter;
}

async function fileOrValue(options, valueName, fileName) {
  if (options[valueName] !== undefined && options[fileName] !== undefined) {
    throw new CliError("USAGE_ERROR", `Use either --${valueName} or --${fileName}, not both.`);
  }
  if (options[fileName] !== undefined) return readFile(path.resolve(options[fileName]), "utf8");
  return options[valueName];
}

export class LinearClient {
  constructor({ apiKey = process.env.LINEAR_API_KEY, apiUrl = process.env.LINEAR_API_URL || DEFAULT_API_URL } = {}) {
    if (!apiKey) throw new CliError("AUTH_ERROR", "LINEAR_API_KEY is not set.");
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }

  async graphql(query, variables = {}) {
    let response;
    try {
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CliError("REQUEST_FAILED", `Linear request failed: ${error.message}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new CliError("AUTH_ERROR", `Linear authentication failed: HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) throw new CliError("HTTP_ERROR", `Linear request failed: HTTP ${response.status} ${response.statusText}`);
      throw new CliError("API_ERROR", "Linear returned invalid JSON.");
    }
    if (payload.errors?.length) {
      throw new CliError("API_ERROR", payload.errors.map((item) => item.message).join("; "));
    }
    if (!response.ok) throw new CliError("HTTP_ERROR", `Linear request failed: HTTP ${response.status} ${response.statusText}`);
    return payload.data;
  }

  async viewer() {
    const data = await this.graphql(`query Viewer { viewer { id name email } organization { id name urlKey } }`);
    return data;
  }

  async teams() {
    const data = await this.graphql(`query Teams { teams(first: 250) { nodes { id key name description } } }`);
    return data.teams.nodes;
  }

  async resolveTeam(reference) {
    const data = await this.graphql(
      `query ResolveTeam($filter: TeamFilter!) { teams(first: 20, filter: $filter) { nodes { id key name } } }`,
      { filter: { or: [
        ...(isUuid(reference) ? [{ id: { eq: reference } }] : []),
        { key: { eqIgnoreCase: reference } },
        { name: { eqIgnoreCase: reference } },
      ] } },
    );
    return exactOne(data.teams.nodes, "Team", reference);
  }

  async states(teamReference) {
    const team = await this.resolveTeam(teamReference);
    const data = await this.graphql(
      `query States($filter: WorkflowStateFilter!) {
        workflowStates(first: 250, filter: $filter) { nodes { id name type position color team { id key name } } }
      }`,
      { filter: { team: { id: { eq: team.id } } } },
    );
    return { team, states: data.workflowStates.nodes };
  }

  async resolveState(reference, teamId, requiredType) {
    const filter = { team: { id: { eq: teamId } } };
    if (reference) {
      filter.or = [
        ...(isUuid(reference) ? [{ id: { eq: reference } }] : []),
        { name: { eqIgnoreCase: reference } },
      ];
    } else if (requiredType) {
      filter.type = { eq: requiredType };
    }
    const data = await this.graphql(
      `query ResolveState($filter: WorkflowStateFilter!) {
        workflowStates(first: 50, filter: $filter) { nodes { id name type position } }
      }`,
      { filter },
    );
    const state = exactOne(data.workflowStates.nodes, "Workflow state", reference || requiredType);
    if (requiredType && state.type !== requiredType) {
      throw new CliError("INVALID_STATE", `Workflow state ${state.name} has type ${state.type}, expected ${requiredType}.`);
    }
    return state;
  }

  async labels(teamReference, groupName) {
    const team = teamReference ? await this.resolveTeam(teamReference) : null;
    const data = await this.graphql(`query Labels {
      issueLabels(first: 250) { nodes {
        id name color isGroup retiredAt team { id key name } parent { id name }
      } }
    }`);
    let labels = data.issueLabels.nodes.filter((label) => !label.retiredAt);
    if (team) labels = labels.filter((label) => !label.team || label.team.id === team.id);
    if (groupName) labels = labels.filter((label) => label.parent?.name.toLowerCase() === groupName.toLowerCase());
    return { team, labels };
  }

  async resolveLabel(reference, teamId, parentGroup) {
    const { labels } = await this.labels();
    const lowered = reference.toLowerCase();
    let matches = labels.filter((label) =>
      (label.id === reference || label.name.toLowerCase() === lowered) &&
      (!label.team || label.team.id === teamId) && !label.isGroup
    );
    if (parentGroup) matches = matches.filter((label) => label.parent?.name.toLowerCase() === parentGroup.toLowerCase());
    return exactOne(matches, "Issue label", reference);
  }

  async projects(teamReference) {
    const team = teamReference ? await this.resolveTeam(teamReference) : null;
    const data = await this.graphql(
      `query Projects($filter: ProjectFilter) {
        projects(first: 250, filter: $filter) {
          nodes { id name slugId url status { id name type } teams(first: 10) { nodes { id key name } } }
        }
      }`,
      { filter: team ? { accessibleTeams: { some: { id: { eq: team.id } } } } : null },
    );
    const projects = data.projects.nodes;
    return { team, projects };
  }

  async resolveProject(reference, teamId) {
    const data = await this.graphql(
      `query ResolveProject($filter: ProjectFilter!) {
        projects(first: 50, filter: $filter) { nodes { id name slugId url teams(first: 10) { nodes { id key name } } } }
      }`,
      { filter: { and: [
        { or: [
          ...(isUuid(reference) ? [{ id: { eq: reference } }] : []),
          { name: { eqIgnoreCase: reference } },
        ] },
        ...(teamId ? [{ accessibleTeams: { some: { id: { eq: teamId } } } }] : []),
      ] } },
    );
    const matches = data.projects.nodes;
    return exactOne(matches, "Project", reference);
  }

  async resolveUser(reference) {
    if (reference.toLowerCase() === "me") return (await this.viewer()).viewer;
    const data = await this.graphql(
      `query ResolveUser($filter: UserFilter!) {
        users(first: 50, filter: $filter, includeDisabled: false) { nodes { id name email active } }
      }`,
      { filter: { or: [
        ...(isUuid(reference) ? [{ id: { eq: reference } }] : []),
        { name: { eqIgnoreCase: reference } },
        { email: { eqIgnoreCase: reference } },
      ] } },
    );
    return exactOne(data.users.nodes, "User", reference);
  }

  async list(teamReference, { includeClosed = false, limit = 50 } = {}) {
    const team = await this.resolveTeam(teamReference);
    const data = await this.graphql(
      `query Issues($first: Int!, $filter: IssueFilter!) {
        issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes { ${SUMMARY_FIELDS} } pageInfo { hasNextPage endCursor } }
      }`,
      { first: limit, filter: connectionFilter(team.id, includeClosed) },
    );
    return { team, issues: data.issues.nodes, pageInfo: data.issues.pageInfo };
  }

  async search(term, teamReference, { includeClosed = false, limit = 50 } = {}) {
    const team = teamReference ? await this.resolveTeam(teamReference) : null;
    const data = await this.graphql(
      `query SearchIssues($term: String!, $first: Int!, $teamId: String, $filter: IssueFilter!) {
        searchIssues(term: $term, first: $first, teamId: $teamId, filter: $filter, includeComments: true) {
          nodes { ${SUMMARY_FIELDS} } totalCount pageInfo { hasNextPage endCursor }
        }
      }`,
      { term, first: limit, teamId: team?.id ?? null, filter: connectionFilter(team?.id, includeClosed) },
    );
    return { team, issues: data.searchIssues.nodes, totalCount: data.searchIssues.totalCount, pageInfo: data.searchIssues.pageInfo };
  }

  async issueCore(reference) {
    const id = parseIssueReference(reference);
    const data = await this.graphql(`query IssueCore($id: String!) {
      issue(id: $id) {
        ${SUMMARY_FIELDS}
        description branchName
        creator { id name email }
        parent { id identifier title url }
      }
    }`, { id });
    return data.issue;
  }

  async issueConnection(issueId, field, selection) {
    const nodes = [];
    let after = null;
    do {
      const data = await this.graphql(`query IssueConnection($id: String!, $after: String) {
        issue(id: $id) {
          ${field}(first: ${PAGE_SIZE}, after: $after) {
            nodes { ${selection} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, { id: issueId, after });
      const connection = data.issue[field];
      nodes.push(...connection.nodes);
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      if (connection.pageInfo.hasNextPage && !after) throw new CliError("API_ERROR", `${field} pagination did not advance.`);
    } while (after);
    return nodes;
  }

  async get(reference) {
    const issue = await this.issueCore(reference);
    const [comments, labels, children, attachments, relations, inverseRelations] = await Promise.all([
      this.issueConnection(issue.id, "comments", `id body createdAt updatedAt editedAt resolvedAt url parent { id } user { id name email } externalUser { id name }`),
      this.issueConnection(issue.id, "labels", `id name color isGroup team { id key name } parent { id name }`),
      this.issueConnection(issue.id, "children", `${SUMMARY_FIELDS}`),
      this.issueConnection(issue.id, "attachments", `id title subtitle url sourceType metadata createdAt creator { id name email }`),
      this.issueConnection(issue.id, "relations", `id type relatedIssue { ${SUMMARY_FIELDS} }`),
      this.issueConnection(issue.id, "inverseRelations", `id type issue { ${SUMMARY_FIELDS} }`),
    ]);
    return { ...issue, comments, labels, children, attachments, relations, inverseRelations };
  }

  async buildIssueInput(options, team, { creating = false } = {}) {
    const input = {};
    const description = await fileOrValue(options, "description", "description-file");
    if (description !== undefined) input.description = description;
    if (options.title !== undefined) input.title = options.title;
    if (creating) input.teamId = team.id;
    if (options.project !== undefined) input.projectId = options.project.toLowerCase() === "none" ? null : (await this.resolveProject(options.project, team.id)).id;
    if (options.state !== undefined) input.stateId = (await this.resolveState(options.state, team.id)).id;
    if (options.assignee !== undefined) input.assigneeId = ["none", "unassigned"].includes(options.assignee.toLowerCase()) ? null : (await this.resolveUser(options.assignee)).id;
    if (options.parent !== undefined) input.parentId = options.parent.toLowerCase() === "none" ? null : parseIssueReference(options.parent);
    if (options.labels !== undefined) {
      const names = options.labels.split(",").map((item) => item.trim()).filter(Boolean);
      input.labelIds = [];
      for (const name of names) input.labelIds.push((await this.resolveLabel(name, team.id)).id);
    }
    const priority = priorityOption(options.priority);
    if (priority !== undefined) input.priority = priority;
    const dueDate = dueDateOption(options.due);
    if (dueDate !== undefined) input.dueDate = dueDate;
    return input;
  }

  async create(options) {
    const team = await this.resolveTeam(required(options.team, "--team"));
    required(options.title, "--title");
    const input = await this.buildIssueInput(options, team, { creating: true });
    const data = await this.graphql(`mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { ${SUMMARY_FIELDS} description } }
    }`, { input });
    return data.issueCreate;
  }

  async update(reference, options) {
    const issue = await this.issueCore(reference);
    const input = await this.buildIssueInput(options, issue.team);
    if (Object.keys(input).length === 0) throw new CliError("USAGE_ERROR", "At least one update field is required.");
    const data = await this.graphql(`mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { ${SUMMARY_FIELDS} description } }
    }`, { id: issue.id, input });
    return data.issueUpdate;
  }

  async comment(reference, body) {
    required(body, "--body or --body-file");
    const id = parseIssueReference(reference);
    const data = await this.graphql(`mutation CommentIssue($input: CommentCreateInput!) {
      commentCreate(input: $input) { success comment { id body createdAt url user { id name email } } }
    }`, { input: { issueId: id, body } });
    return data.commentCreate;
  }

  async setLabel(reference, labelReference, add) {
    const issue = await this.issueCore(reference);
    const label = await this.resolveLabel(labelReference, issue.team.id);
    const field = add ? "issueAddLabel" : "issueRemoveLabel";
    const data = await this.graphql(`mutation SetIssueLabel($id: String!, $labelId: String!) {
      ${field}(id: $id, labelId: $labelId) { success issue { ${SUMMARY_FIELDS} labels(first: 250) { nodes { id name } } } }
    }`, { id: issue.id, labelId: label.id });
    return { ...data[field], label };
  }

  async triage(reference, labelReference, groupName = "Triage") {
    const issue = await this.get(reference);
    const target = await this.resolveLabel(labelReference, issue.team.id, groupName);
    const current = issue.labels.filter((label) => label.parent?.name.toLowerCase() === groupName.toLowerCase());
    const removedLabelIds = current.filter((label) => label.id !== target.id).map((label) => label.id);
    if (current.some((label) => label.id === target.id) && removedLabelIds.length === 0) {
      return { success: true, unchanged: true, issue, label: target };
    }
    const input = { addedLabelIds: [target.id], removedLabelIds };
    const data = await this.graphql(`mutation TriageIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { ${SUMMARY_FIELDS} labels(first: 250) { nodes { id name parent { id name } } } } }
    }`, { id: issue.id, input });
    return { ...data.issueUpdate, label: target, removedLabelIds };
  }

  async terminalState(reference, type, stateReference) {
    const issue = await this.issueCore(reference);
    const state = await this.resolveState(stateReference, issue.team.id, type);
    const data = await this.graphql(`mutation TerminalState($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { ${SUMMARY_FIELDS} } }
    }`, { id: issue.id, input: { stateId: state.id } });
    return { ...data.issueUpdate, state };
  }

  async relate(reference, relatedReference, type) {
    if (!["blocks", "related", "duplicate", "similar"].includes(type)) {
      throw new CliError("USAGE_ERROR", "--type must be blocks, related, duplicate, or similar.");
    }
    const input = {
      issueId: parseIssueReference(reference),
      relatedIssueId: parseIssueReference(relatedReference),
      type,
    };
    const data = await this.graphql(`mutation RelateIssues($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) {
        success issueRelation { id type issue { id identifier title } relatedIssue { id identifier title } }
      }
    }`, { input });
    return data.issueRelationCreate;
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const parsed = parseArguments(argv);
  if (!parsed.command || parsed.command === "help" || parsed.options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const client = new LinearClient();
  const { command, positionals, options } = parsed;
  let data;

  switch (command) {
    case "auth": data = await client.viewer(); break;
    case "teams": data = await client.teams(); break;
    case "states": data = await client.states(required(options.team, "--team")); break;
    case "labels": data = await client.labels(options.team, options.group); break;
    case "projects": data = await client.projects(options.team); break;
    case "list": data = await client.list(required(options.team, "--team"), { includeClosed: Boolean(options.all), limit: limitOption(options.limit) }); break;
    case "search": data = await client.search(required(positionals.join(" "), "Search text"), options.team, { includeClosed: Boolean(options.all), limit: limitOption(options.limit) }); break;
    case "get": data = await client.get(required(positionals[0], "Issue reference")); break;
    case "create": data = await client.create(options); break;
    case "update": data = await client.update(required(positionals[0], "Issue reference"), options); break;
    case "comment": data = await client.comment(required(positionals[0], "Issue reference"), await fileOrValue(options, "body", "body-file")); break;
    case "add-label": data = await client.setLabel(required(positionals[0], "Issue reference"), required(options.label, "--label"), true); break;
    case "remove-label": data = await client.setLabel(required(positionals[0], "Issue reference"), required(options.label, "--label"), false); break;
    case "triage": data = await client.triage(required(positionals[0], "Issue reference"), required(options.label, "--label"), options.group); break;
    case "complete": data = await client.terminalState(required(positionals[0], "Issue reference"), "completed", options.state); break;
    case "cancel": data = await client.terminalState(required(positionals[0], "Issue reference"), "canceled", options.state); break;
    case "relate": data = await client.relate(required(positionals[0], "Issue reference"), required(options.to, "--to"), required(options.type, "--type")); break;
    default: throw new CliError("USAGE_ERROR", `Unknown command: ${command}. Run with --help.`);
  }

  output({ ok: true, data });
}

const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (entryPath === realpathSync(fileURLToPath(import.meta.url))) main().catch(fail);

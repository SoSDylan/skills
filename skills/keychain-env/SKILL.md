---
name: keychain-env
description: Manages macOS Keychain credentials and injects them into child-process environments. Use when a macOS user mentions Keychain or Keychain Access, wants to store, update, check, retrieve, or remove a credential there, or needs Keychain-backed environment variables for a command.
---

# Keychain Environment

Use the bundled helper as the safety boundary. Resolve this skill's directory to
an absolute path, then invoke:

```bash
node "<keychain-env-skill-dir>/scripts/keychain-env.mjs" <command>
```

## 1. Pin down the environment name

Proceed only on macOS and require the environment-variable name. The helper
always derives account `<current macOS username>` and service
`keychain-env:<ENV_NAME>`; neither has an override. `check`, `exec`, and `delete`
may select a keychain path, while `store` uses the default keychain. Identity is
ready when the environment name is explicit and valid.

## 2. Choose the requested branch

### Store or update

Run `store`; Apple's `security` program prompts without echo and the helper
places no credential value in process arguments.

```bash
node "<keychain-env>/scripts/keychain-env.mjs" store --env API_TOKEN
```

Storage is complete when the helper returns `ok: true`, then `check` confirms
`exists: true`.

### Check without revealing

```bash
node "<keychain-env>/scripts/keychain-env.mjs" check --env API_TOKEN
```

Report only the status. The check is complete when `exists` is known or a
specific Keychain error is returned.

### Run with environment variables

Each `--env` starts one credential mapping. Put the target command after `--`.

```bash
node "<keychain-env>/scripts/keychain-env.mjs" exec \
  --env API_TOKEN --env API_SECRET -- command --flag
```

Choose a target that consumes credentials rather than displaying its
environment. The helper validates environment names, resolves every credential,
redacts literal values from child output, and reports the child's exit status.
Execution is complete when every lookup succeeds and the child exits with the
reported status.

If the user specifically needs a variable in their current interactive shell,
read [REFERENCE.md](REFERENCE.md#current-shell-environment). An agent's separate
shell calls cannot preserve parent-shell environment changes.

### Delete

First ask: `Delete the Keychain credential for <ENV_NAME> from the current
macOS account? This cannot be undone.` Run this only after the user explicitly
confirms that exact deletion:

```bash
node "<keychain-env>/scripts/keychain-env.mjs" delete \
  --env API_TOKEN --confirm-delete
```

Deletion is complete when `ok: true` is followed by a `check` returning
`exists: false`.

## 3. Handle failures

Return the helper's JSON code without exposing command arguments or credential
values. For locked keychains, access denial, missing items, duplicate managed
credentials across keychains, and non-default keychains, read
[REFERENCE.md](REFERENCE.md#diagnosis). The request is complete when the action
is verified or the user has a specific safe next step.

# Keychain environment reference

## Current-shell environment

A child process cannot modify its parent's environment. When the user needs a
credential in the interactive shell they are currently using, have them paste a
same-shell assignment after setting `_kc_env` to the intended name:

```bash
_kc_env=API_TOKEN
_kc_trace=
case $- in *x*) _kc_trace=1; set +x ;; esac

_kc_value="$(security find-generic-password \
  -a "$(/usr/bin/id -un)" \
  -s "keychain-env:$_kc_env" \
  -w)"
_kc_status=$?

if [ "$_kc_status" -eq 0 ]; then
  export "$_kc_env=$_kc_value"
fi
unset _kc_value

if [ "$_kc_trace" = 1 ]; then set -x; fi
unset _kc_env _kc_trace _kc_status
```

This persists only in that shell and its future children. Confirm success by
running the consuming command, not by printing the variable. For a different
keychain, append its path after `-w`.

## Diagnosis

The helper returns stable JSON error codes and omits credential values and
selectors:

| Code | Meaning | Safe next step |
|---|---|---|
| `NOT_FOUND` | No item matched the derived identity | Verify the environment name; use `store` only when the user wants to create it |
| `KEYCHAIN_LOCKED` | The selected keychain is locked | Unlock it in Keychain Access or with an operator-run `security unlock-keychain`, then retry |
| `ACCESS_DENIED` | Access was denied or canceled | Let the user approve the macOS prompt; inspect the item's Access Control in Keychain Access if denial persists |
| `INTERACTION_REQUIRED` | The session cannot display a required prompt | Retry from the user's interactive macOS terminal session |
| `AMBIGUOUS` | An environment name is absent or repeated | Supply each required environment name exactly once |
| `UNSUPPORTED_OS` | The helper is not running on macOS | Stop; this skill has no non-macOS fallback |
| `UNSUPPORTED_OPERATION` | Safe interactive storage was requested for a non-default keychain | Add or update the item in Keychain Access, then use the helper to check or consume it |
| `SECURITY_ERROR` | `security` failed for another reason | Retry with the same environment name from an interactive terminal, then inspect Keychain Access |

The derived account/service identity can exist in more than one keychain in the
default search list. If the observed item is uncertain, stop and ask the user
for the intended keychain path; pass it with `--keychain <path>` on `check` or
`delete`, or after the relevant `--env` on `exec`. Avoid broad searches because
their metadata can disclose unrelated item names.

Storage defaults to the user's default keychain, normally the login keychain.
Apple's safe prompt requires `-w` to terminate `add-generic-password`, so the
helper rejects a keychain path on `store`; use Keychain Access for that branch.
The helper passes no `-A` access grant.

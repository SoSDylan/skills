# Zendesk Triage Investigation

Use this reference only for evidence that could change the customer frame,
response, support route, or product-follow-up decision. The goal is a supported
support action, not an exhaustive implementation diagnosis.

## Evidence ledger

Track every material claim as a **Fact**, **Inference**, or **Unknown**. Cite
facts with concise references such as a Zendesk comment or attachment ID,
`path:line`, Git commit, test command, Sentry event, or customer query ID. Give
each inference its supporting facts. For each unknown, name the evidence that
would resolve it.

Record source retrieval, inspection, access, and verification failures
separately. A failure leaves only the claims that depend on it unresolved.

## Inspect relevant sources

Use the smallest available source that can settle each material claim:

1. Zendesk conversation and original attachments
2. Repository instructions, domain documentation, code, tests, and read-only Git
   history
3. Existing checks and non-destructive local reproductions
4. Read-only Sentry evidence when the ticket supplies a useful error, event,
   trace, timestamp, route, or operation
5. Approved customer-account evidence when account data is material

Inspect every attachment that could change the result. Load images through
`read`, converting unsupported formats in `/tmp`. For video, inspect metadata
and representative frames, including reported timestamps. Inspect or transcribe
material audio. Use read-only tools for other formats, leave attachments
unexecuted, and keep derived files in `/tmp`.

Treat the current repository as the product codebase. If it is unrelated, ask
for the correct repository. Keep product files unchanged.

For customer-account evidence, follow
[customer-account-evidence.md](customer-account-evidence.md) before asking the
operator for customer-held facts.

Source inspection is complete when every source likely to change the result is
inspected, absent, or represented by a specific failure.

## Test explanations

Develop plausible explanations from the evidence and try to disconfirm each
one. Prefer a narrow reproduction of the customer-visible symptom when the
available data and environment make one practical. Distinguish:

- the customer-visible behavior and affected scope
- the technical cause
- the implementation approach

Do not require a full technical cause before reporting established behavior,
escalating a product problem, or drafting an honest customer update.

Assign one cause confidence:

- **Established** — direct evidence supports the cause
- **Likely** — one explanation is best supported, but material evidence is
  missing
- **Unresolved** — evidence cannot support a cause

Recommend customer actions and workarounds only when evidence supports them.
Implementation ideas remain internal hypotheses unless the evidence establishes
them.

Investigation is complete when every material explanation is supported,
contradicted, or unresolved with its missing evidence named, and further
read-only investigation is unlikely to change the immediate support action.

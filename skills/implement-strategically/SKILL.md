---
name: implement-strategically
description: Implement features or fixes with attention to surrounding architecture, existing building blocks, and ease of future change. Use when implementation should include deliberate reuse and bounded refactoring.
---

# Implement Strategically

Deliver the requested behaviour while leaving the affected code easier to
understand and change. Scale exploration to the task. The primary agent owns
implementation; this workflow is self-contained.

## 1. Establish the goal

Read the request, supplied specs or tickets, and repository instructions.
Create a short internal checklist of acceptance criteria, scope exclusions,
constraints, and assumptions. Read relevant architecture guidance and recorded
decisions when available.

Use known plans and demonstrated patterns of change to inform design. Improve
clarity and changeability of today's code; build future capabilities only when
supported by requirements or evidence.

Resolve routine choices autonomously. Ask when ambiguity materially changes
public behaviour, the data model, an external contract, or scope.

Complete when the acceptance criteria are actionable and material ambiguities
are resolved.

## 2. Explore the surrounding system

Before choosing files to change:

1. Trace the relevant flow, including where state and business rules live and
   the callers and consumers affected by the change.
2. Inspect neighboring features and search for existing components, utilities,
   services, and tests that provide the needed behaviour. Check shared building
   blocks and their usages, beyond the first feature file found.
3. Identify ownership, contracts to preserve, and the repository's verification
   commands. Distinguish established conventions from incidental or legacy
   patterns using repository guidance and actual usage.

For shared infrastructure, make the interface concrete before building it:

- Inspect one ordinary consumer using defaults and one real customized consumer
  when present. Existing callers or focused test fixtures can serve as examples.
- Trace one input through processing to output, naming the owner and data
  representation at each transformation.
- Record when no customized consumer exists; that is not a reason to invent an
  extension point.

For UI work, find the app's shared primitives, such as Button, before choosing
native elements or creating replacements. Follow established primitives and
conventions wherever they apply.

Complete when the relevant flow, reusable candidates, intended owner, affected
consumers, and checks are known; shared-infrastructure changes also have concrete
consumer examples and an execution trace. Briefly explain what you found and why
the proposed approach fits, then proceed within the agreed scope.

## 3. Choose and implement a coherent change

For each responsibility, choose deliberately:

- Reuse an existing implementation when it fits.
- Extend it when the addition belongs to the same responsibility and preserves
  a clear interface for existing consumers.
- Create a separate implementation when sharing would require awkward flags,
  unrelated responsibilities, or unnecessary coupling. Record the alternatives
  considered and the concrete reason for separating it.

Prefer clear ownership, one source of truth, and understandable interfaces over
minimizing the diff. Make directly necessary small refactors autonomously. Fix
related inconsistencies in code already being changed, and track those fixes
for the final report. Report broader cleanup opportunities separately.

Before substantial restructuring, changes to shared responsibilities or public
contracts, or a refactor that becomes separate work, present a concrete proposal
with its reason, affected areas, and tradeoffs and wait for user approval unless
that work is already explicitly authorized.

Work in vertical slices. When a slice uncovers another responsibility, an
unfamiliar dependency, or uncertainty about reuse, return to step 2 for that
area before writing more code. Exploration continues as the work develops.

Use TDD when requested or already agreed. Otherwise, add or update meaningful
focused tests in the repository's style and run affected checks after meaningful
slices.

Complete when every acceptance criterion is implemented and each new separate
implementation has a reason grounded in the code inspected.

## 4. Verify and stabilize

Run focused behaviour tests, applicable typecheck/lint/build checks, and the full
test suite once when practical. Include affected consumers and adjacent flows,
especially when extending shared code. Fix failures introduced by the change;
report verified pre-existing failures separately.

Before delegating review, perform the architectural pass: check ownership,
duplicated rules, scattered special cases, shared primitive usage, compatibility
with existing consumers, and code made obsolete by the change. Remove obsolete
code caused by this work. For shared infrastructure, exercise the consumer
examples against the final interface and recheck the execution trace, including
any serialization and delivery steps. Passing tests does not replace this pass.

Review the complete change, including untracked files, against the original
request and repository standards. When available, invoke `code-review` once,
supplying the original spec or request, `git diff HEAD`, and all paths from
`git ls-files --others --exclude-standard`. For shared infrastructure, also supply
the consumer-example paths and final execution trace. Otherwise perform the
review directly. This is agent legwork, not an additional user-approval gate.

Triage findings, fix implementation-caused problems in one correction pass,
and rerun affected checks. Report unrelated improvements and remaining findings
rather than starting another review cycle.

Complete when the requested behaviour and affected contracts have been checked,
and remaining failures or verification limits are accounted for.

## 5. Report the decisions

Report concisely:

- What changed and how it fits the surrounding design.
- New components or other separate implementations: list each, the existing
  options considered, and why reuse or extension was unsuitable.
- Related inconsistencies fixed: list each cleanup beyond the requested behaviour.
- Verification results, material assumptions, and remaining limitations or
  broader improvement opportunities.

State when there were no new separate implementations or related cleanups.
Keep the decision lists concrete and proportional to the change.

Leave changes uncommitted unless requested. When creating commits, use
`draft-commits` if available, respecting its invocation and approval rules.

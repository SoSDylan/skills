# Candidate and accounting policy

This is the single source of truth for storage accounting, candidate eligibility,
and cleanup mechanisms. Apply it while building a report and again before
planning cleanup.

## Physical accounting

- Report the startup APFS container once. Volumes in one container share space;
  their capacities are not additive.
- `du` and `stat` show allocated blocks attributable to a path, not guaranteed
  exclusive blocks. Label that value **allocated size**.
- Reconcile visible allocated usage with APFS Data-volume usage. Report the
  difference as an unexplained residual and list each inaccessible branch that
  could contribute to it.
- Keep selectable candidates disjoint. Parent totals can provide context but
  cannot also be selectable when child candidates represent their contents.
- Treat clone-, hard-link-, compression-, or snapshot-affected reclaim as
  unknown unless exclusive reclaim can be established. Use zero as the lower
  bound when sharing is known or suspected.
- A move within the same APFS container, including a move to Trash, immediately
  reclaims zero bytes.

## Candidate matrix

| Class | Selectable action | Required scope | Default risk |
|---|---|---|---|
| Generated cache, log, index, build output, or downloaded dependency | Owner cleanup or exact generated-root deletion | Exact recognized root and all contents under it | Low |
| Renewable runtime, simulator, emulator, model, SDK, or toolchain | Owning application's or package manager's removal mechanism | Exact runtime, device, model, workload, package, or version IDs | Medium |
| App-managed image, volume, backup state, database, or content store | Owning application's management mechanism | Exact listed objects or the exact whole-store candidate | Medium or high |
| Personal file | Move to Trash; permanent deletion is a separate choice | Each exact file, with size, type, and identity revalidated | High |
| Protected, inaccessible, or unclassified content | Report only | None | High |

A global native cleanup is eligible only when the report exposes its entire
effect as one candidate. Before planning it, enumerate affected object IDs or
paths with a read-only listing or dry-run when the tool supports one. If its
complete effect cannot be bounded, provide guidance instead of an executable
cleanup action.

For direct deletion of a generated root, the authorization scope is “all
contents under this exact canonical root at execution.” The report and plan must
say this explicitly. Stop the owner first, revalidate the root's type and
classification, and issue a revised plan if its allocated size changes by more
than 10% or 500 MiB, whichever is smaller.

For personal files, bind approval to canonical path, filesystem identity, type,
size, and modification time. A personal directory is eligible for permanent
deletion only when every contained item is enumerated in the plan.

## Absolute mechanism boundaries

Use an owning application, package manager, or macOS interface for:

- Docker images, volumes, build cache, and sparse disks such as `Docker.raw`
- Xcode simulator runtimes and `/System/Library/AssetsV2`
- Homebrew, language SDK, workload, and package-manager installation roots
- Time Machine or APFS snapshots
- Backblaze and other backup internals
- application databases and managed content stores

Keep these report-only unless a supported object-scoped mechanism is available:

- current macOS system data and the active sealed system snapshot
- direct targets under `/System`, `/bin`, `/sbin`, `/usr`, `/private/var`, or
  `/Library/Updates`
- protected Mail, Messages, Photos, Safari, account, and security databases
- source-control metadata such as `.git`, project source, and unclassified files
- dataless File Provider or iCloud placeholders
- symbolic links, mount points, cross-filesystem targets, and inaccessible paths

Native management of a protected root is allowed only when the native tool's
bounded objects are the approved candidate; direct filesystem deletion remains
out of scope.

## Trash

Moving selected personal files to Trash is reversible but does not free space.
Report immediate reclaim as zero and potential reclaim separately.

Treat permanent removal from Trash as a new candidate:

- Permanently remove only the exact trashed objects previously selected, or
- inventory all Trash contents and expose **Empty all Trash** as one high-risk
  candidate whose plan lists every top-level object and total allocated size.

A generic Empty Trash action is never an implicit follow-up to moving files.

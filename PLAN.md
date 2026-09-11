# FlexVault VS Code Extension: Implementation Plan

Build plan for `fxv-vscode-plugin`, a VS Code extension that integrates FlexVault into the editor through the `fxv` CLI.

**Scope of v1:** full read and write. Everything through Phase 6 ships together, including the mutation queue, the write-timeout policy, interrupted-operation recovery, and the publish flow.

Targets `fxv-core` `0.9.0` and the schemas in `fxv-api-rs/schemas/`. CLI behavior stated here was checked against a running `0.9.0` binary, not only read from source. Where a decision needs justification or has a history, `RATIONALE.md` has it; this file states what to build.

---

## 0. Ground rules

1. **No SCM logic in the extension.** Every operation maps to a CLI subcommand and renders its result.
2. **All process execution lives in `src/cli/`.** No `spawn` anywhere else. No caller outside `src/cli/` sees a process, an exit code, or an argv array; the runner's public API is typed command functions returning envelopes. This is what keeps a later move to `fxv rpc` or `fxv-agent` an internal change.
3. **Responses are envelopes.** Parse `{program, message}`, check `message.kind`, then read `message.payload`. `kind: "error"` is failure regardless of exit code.
4. **`snapshot`, `publish`, and `cat` have no JSON success path.** `--format json` is appended for everything else. These three still emit a normal error envelope **on stdout** when they fail, with stderr empty; on success they print human text and no JSON. The runner attempts an envelope parse on all three: an envelope means failure and carries a real message, a parse failure at exit 0 means success. Never look to stderr for the message.
5. **Two global flags are appended** unless the caller already supplied them: `--unattended` and `--no-color`. Not `--no-pager` or `--no-progress`, which print `Warning: The command '...' is not implemented yet.` to stderr on every call and are otherwise unwired. `--unattended` also suppresses the CLI's update-check notice and the detached refresh process it spawns.
6. **Two versions are gated:** `program.version` (the binary) and `message.version` (the payload contract being parsed). See 2.6.
7. **Revisions are branch-qualified strings** (`main.11`, `main.11.123`, `main.-.1`), never integers. Only `src/cli/revision.ts` builds them. See 2.7.
8. **Exit codes are the failure taxonomy.** Branch on the number, never on message text. See 2.4.

---

## Module map

```
src/
  extension.ts          activate / deactivate; wiring only, no logic
  cli/
    discovery.ts        binary location, cached, invalidated on settings change
    workspace.ts        .fxv_workspace parent walk, cached per folder
    runner.ts           spawn, flag application, mutation queue, timeouts; runJson / runRaw
    envelope.ts         parse, validate, classify errors and exit codes
    versionGuard.ts     program.version range + per-kind message.version table
    revision.ts         revision spec build and parse, including the '-' placeholder
    lockErrors.ts       exit-99 classification, holder extraction
    commands.ts         one typed function per subcommand (2.9); the only public surface
    types.generated.ts  json-schema-to-typescript output; never hand-edited
  state/
    statusCache.ts      single status snapshot, debounce, coalescing
    contextKeys.ts      sole owner of setContext
    safetyGuards.ts     dirty editors, active debug session
    recovery.ts         exit-98 detection, banner, resume paths
  scm/
    provider.ts         createSourceControl, groups, input box, count badge
    resources.ts        status payload to resource states (3.2, 3.3)
    decorations.ts      FileDecorationProvider for the Explorer
    quickDiff.ts        quickDiffProvider plus the content cache (5.2)
  providers/
    contentProvider.ts  the fxv: URI scheme
    historyTree.ts      history TreeDataProvider
  ui/
    statusBar.ts        branch, revisions behind, auth state
    log.ts              output channel, argv redaction
    progress.ts         withProgress wrappers and cancellation policy
  commands/
    index.ts            command registration table and implementations
```

Dependency direction is strictly downward: `commands/` and `scm/` depend on `state/` and `cli/`; `cli/` depends on nothing in the extension but `ui/log.ts`.

---

## Phase 1: Scaffolding and manifest

**Goal:** an installable extension that activates correctly and is inert everywhere else.

### 1.1 Project setup

- `npm init`; add `@types/vscode`, `typescript`, `esbuild`, `@vscode/test-cli`, `@vscode/test-electron`, `json-schema-to-typescript`, and a unit runner (`vitest` unless the team prefers `mocha`).
- TypeScript strict. Target the VS Code engine floor.
- Bundle with esbuild to `dist/extension.js`. Do not ship `node_modules`.
- Type generation is a build step, not a checked-in artifact refresh: `npm run gen:types` reads `fxv-api-rs/schemas/*.json` and writes `src/cli/types.generated.ts`. CI fails if the generated output differs from what is committed.

### 1.2 Identity

`name: flexvault-vscode`, `publisher: flexvault`, `displayName: FlexVault`, `categories: ["SCM Providers"]`, `engines.vscode: ^1.85.0` (older floors constrain `FileDecorationProvider` and tree view APIs), `extensionKind: ["workspace"]` since the extension spawns a local process.

### 1.3 Activation

Two events, no `*`:

- `workspaceContains:.fxv_workspace`, for the case where the opened folder is the repo root. `.fxv_workspace` is a **directory**; if a non-glob pattern turns out not to match one, fall back to a glob on a known file inside it.
- `onStartupFinished`, the backstop for the common case where the marker sits in a parent of the opened folder.

Activation sequence, in order:

1. Resolve the workspace root (2.2). If none, set `flexvault.enabled` false, register only the palette commands, and return. A wrong activation must cost one synchronous directory walk.
2. Resolve the binary (2.1) and run the version guard (2.6). If incompatible, set `flexvault.cliIncompatible`, show the welcome view, and register nothing else.
3. Run a full `status`. Exit 98 routes to recovery (6.5) instead of normal startup.
4. Register the SCM provider, decorations, providers, status bar, and commands; derive context keys; start the watcher.

### 1.4 Contribution surface

**Settings,** all under `flexvault.` in `contributes.configuration`.

| Setting               | Type     | Default | Scope         | Notes                                                   |
| --------------------- | -------- | ------- | ------------- | ------------------------------------------------------- |
| `cliPath`             | string   | `""`    | **`machine`** | Path to `fxv`. Machine scope is mandatory: see 1.5.     |
| `readTimeoutSeconds`  | number   | `60`    | window        | `status`, `history`, `changeinfo`, `cat`. `0` disables. |
| `writeTimeoutSeconds` | number   | `0`     | window        | Mutating commands. `0` disables. See 2.3.               |
| `refreshDebounceMs`   | number   | `300`   | window        | Status refresh coalescing.                              |
| `watchEnabled`        | boolean  | `true`  | resource      | Kill switch for the file watcher (3.4).                 |
| `watchExclude`        | string[] | `[]`    | resource      | Extra globs excluded from the watcher.                  |
| `contentCacheSizeMB`  | number   | `512`   | machine       | On-disk `cat` cache cap (5.2).                          |
| `historyLimit`        | number   | `50`    | window        | `history -n`.                                           |
| `logLevel`            | enum     | `info`  | window        | `off` \| `error` \| `info` \| `debug`.                  |

**Context keys.** `src/state/contextKeys.ts` is the only caller of `setContext`.

| Key                         | Meaning                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `flexvault.enabled`         | A FlexVault root was resolved. Gates the entire UI.                              |
| `flexvault.loggedIn`        | `status.current_user` is non-null.                                               |
| `flexvault.hasConflicts`    | At least one file carries `conflict_state`. Blocks publish.                      |
| `flexvault.busy`            | A mutating command is in flight. Disables the input box and mutating menu items. |
| `flexvault.interrupted`     | An interrupted operation is pending recovery (6.5).                              |
| `flexvault.headState`       | `empty_branch` \| `unparented_draft` \| `parented_draft`.                        |
| `flexvault.cliIncompatible` | Version guard verdict is a block. Suppresses everything but the palette.         |

**Commands and placement.** All IDs under `flexvault.`; every mutating entry additionally carries `when: flexvault.enabled && !flexvault.busy && !flexvault.interrupted && !flexvault.cliIncompatible`.

| Command                                         | Menu placement                             | Additional `when`                               |
| ----------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `refresh`                                       | `scm/title` (nav group, icon)              |                                                 |
| `snapshot`                                      | `scm/title`                                |                                                 |
| `publish`                                       | `scm/title`, `acceptInputCommand`          | `!flexvault.hasConflicts && flexvault.loggedIn` |
| `sync`                                          | `scm/title`, status bar                    |                                                 |
| `goto`                                          | palette, history tree item                 |                                                 |
| `revert`                                        | `scm/resourceState/context` (multi-select) |                                                 |
| `resolveMine` / `resolveTheirs` / `resolveUndo` | `scm/resourceState/context`                | resource is in the Conflicts group              |
| `diffAgainstBase`                               | resource default click, `editor/title`     |                                                 |
| `login`                                         | palette, status bar                        | `!flexvault.loggedIn`                           |
| `logout`                                        | palette                                    | `flexvault.loggedIn`                            |
| `resume` / `resumeRollback`                     | banner actions only                        | `flexvault.interrupted`                         |
| `clearCache`                                    | palette                                    |                                                 |
| `showLog`                                       | palette, notification action               |                                                 |
| `openSettings`                                  | `scm/title` overflow, palette              |                                                 |

**Welcome views** (`contributes.viewsWelcome`), one action button each, no prose:

| State                    | Action                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| No FlexVault root found  | Open the docs on `fxv init`. The extension does not wrap provisioning (2.9). |
| CLI not found            | Open the `flexvault.cliPath` setting.                                        |
| CLI version incompatible | The 2.6 action: upgrade the CLI, or upgrade the extension.                   |
| `empty_branch`           | Nothing snapshotted yet; button runs `flexvault.snapshot`.                   |

No keybindings ship in v1.

### 1.5 Workspace trust and secrets

- **`flexvault.cliPath` is `"scope": "machine"`.** It names an executable. A workspace-scoped setting would let a cloned repo point the extension at an arbitrary binary and have it run on folder open.
- **`capabilities.untrustedWorkspaces` is `{"supported": false}`,** with a reason naming the executable spawn. The extension does nothing useful without running a process, so partial support would be a fiction.
- **If a credential ever exists it goes in `vscode.SecretStorage`,** never settings or `workspaceState`. FlexVault auth is username-only today (4.2), so this is a reserved seam. Stating it now is what stops someone reaching for a setting later.
- Caches live under `context.globalStorageUri` and are safe to delete at any time.

### 1.6 Repo hygiene

The repository exists (`main`, no commits yet); remote is `github.com/FlexVaultSCM/fxv-vscode-plugin`. Add `LICENSE.md`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, a populated `.gitignore`, and:

- `.github/workflows/ci.yml`: lint, typecheck, generated-types check, unit tests, `vsce package` dry run.
- `.github/workflows/release-please.yml` plus `release-please-config.json` with `release-type: node`. Conventional commits, `bump-minor-pre-major: true`.

**Done when:** the extension installs from a local `.vsix`, activates both when the repo root is the opened folder and when it is a parent of it, logs its version to the output channel, and stays inert in a non-FlexVault workspace and in an untrusted one.

---

## Phase 2: The CLI runner

**Goal:** a typed, tested bridge to `fxv`. Everything else is UI on top of it.

### 2.1 Binary discovery (`cli/discovery.ts`)

1. `flexvault.cliPath`, if set and the file exists.
2. Platform-standard locations. Windows: `%LOCALAPPDATA%\fxv\bin\fxv.exe`, then `%ProgramFiles%\FlexVault\bin\fxv.exe`. macOS and Linux: `/usr/local/bin/fxv`, `/opt/homebrew/bin/fxv`, `$HOME/.cargo/bin/fxv`.
3. Scan `PATH`.
4. Fall back to the bare name and let the OS resolve it.

Cache the result. Invalidate on settings change and reset the version guard verdict at the same time.

### 2.2 Workspace root discovery (`cli/workspace.ts`)

Walk up from each `workspaceFolder` looking for a `.fxv_workspace` directory; its parent is the repo root and the `cwd` for every invocation. Cache per folder, invalidate on `onDidChangeWorkspaceFolders`.

v1 scopes to a single root. If folders resolve to different roots, use the first and warn.

### 2.3 Execution (`cli/runner.ts`)

- `child_process.spawn` with an argv array. Never a shell string; paths contain spaces.
- Two entry points: `runJson()` for envelope commands, and `runRaw()` for `cat`, which returns a `Buffer` and is the only code permitted to skip envelope parsing. It must never decode to a string: `cat` streams raw bytes with no encoding applied and the target workloads are game assets.
- Discriminated result: `{ok: true, payload}` or `{ok: false, message, exitCode, errorData, raw}`.
- Ground rules 4 and 5 are applied here, centrally.
- Serialize mutating commands through a queue and set `flexvault.busy`. Reads may run concurrently with each other but not during a mutation.

**Timeouts split by command class. Writers are never killed.** Killing a `sync`, `goto`, `revert`, or `resolve` mid-flight leaves the workspace inconsistent behind a sync journal, which is the state `fxv resume` exists to repair.

- Reads honor `readTimeoutSeconds`: `child.kill()`, then `SIGKILL` after a grace period.
- Writes honor `writeTimeoutSeconds` (default `0`, disabled). When set, the runner **stops waiting** and reports a timeout but does **not** kill the child, and flags the workspace as possibly mid-operation so recovery runs on the next refresh.
- `withProgress` cancellation follows the same split: reads cancel by killing, writes decline and say so.
- `deactivate()` follows the same rule: dispose watchers, providers, and the status bar, and let any in-flight write run to completion detached. Window reload must not be a way to manufacture an interrupted sync.

### 2.4 Envelope parsing and error classification (`cli/envelope.ts`)

Parse in this order:

1. `JSON.parse` the trimmed stdout whole. This is the expected path.
2. On failure, split into candidate objects with a brace-depth scanner that respects string literals and escapes, then take the last complete object that parses.
3. On failure, report a parse error carrying the raw stdout and log the full buffer.

Then validate against `envelope.schema.json`, feed both versions to the guard (2.6), and treat `kind === "error"` as failure. A `kind` ending in `-progress` is interim: keep the last one and keep reading. Nothing emits those today; the path exists so step 2 has a defined meaning.

**The error payload carries more than a message.** Alongside `message` and `exit_code` it may carry **`error_data`, a nested independently versioned sub-envelope** with its own `kind`, `version`, and `payload`:

```json
{
  "message": "A previous `fxv goto` was interrupted ...",
  "exit_code": 98,
  "error_data": {
    "kind": "interrupted-sync",
    "version": "1.0",
    "payload": {
      "operation": "goto",
      "completed_entries": 2,
      "remaining_entries": 4,
      "failed_entries": 0,
      "preserved_entries": 0,
      "sampled_unfinished_paths": ["a.txt", "f3.txt"]
    }
  }
}
```

`error_data` is absent from `error.schema.json`, which declares `additionalProperties: false`, so a strict validator rejects a legitimate error. Validate the error payload leniently until the schema PR in 2.5 lands, and guard `error_data.version` like any other payload version.

**Exit code taxonomy.** Classification lives here; every caller branches on the classification, never on text.

| Exit  | Meaning                                                              | Runner result                                      | UI behavior                                                |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `0`   | Success                                                              | Parsed payload                                     | Render                                                     |
| `1`   | General failure                                                      | Error envelope, `payload.message`                  | Notification plus **Show Log**                             |
| `98`  | Interrupted operation pending                                        | Error envelope with `error_data: interrupted-sync` | Recovery banner, block mutations (6.5)                     |
| `99`  | Workspace locked by another process                                  | Error envelope, holder named in message            | "Busy in another application" plus **Retry** (2.8)         |
| `127` | Process died without reporting: killed mid-operation, or a CLI panic | No envelope; stdout and stderr both empty          | Treat as possibly mid-operation; the next `status` decides |

### 2.5 Types (`cli/types.generated.ts`)

Generate from `fxv-api-rs/schemas/*.json` with `json-schema-to-typescript` so a wire-format change breaks the build rather than production.

v1 needs `Envelope`, `StatusPayload`, `HistoryPayload`, `ChangeInfoPayload`, `WorkspaceSyncPayload`, `ErrorPayload`, `LoginPayload`, `LogoutPayload`, `DoctorPayload`, and the shared `FileStatus`, `CommitRef`, `CommitInfo`, `ChangeKind`, `AuthorDetails`.

**One payload, several kinds.** `workspace_sync.schema.json` is the shared payload for the workspace-sync family, but the envelope `kind` is the command name: `goto`, `sync`, `revert`, and `resume` each return under their own kind, all carrying `target_revision`, `files_updated_count`, `error_count`, `files_updated`, with `created_revisions` on `revert`. The type is shared; the version table in 2.6 needs a row per kind.

**Three upstream PRs in `fxv-api-rs`, owned by this team, landing together as Phase 2 work:**

1. **`conflict_state` gets a real shape** in `common.schema.json`, mirrored from the Rust type the CLI serializes. It is currently an untyped `{"type": "object"}`, so generation yields `object`. Presence-only conflict rendering is not what ships. Hard prerequisite for 3.3a and nothing else.
2. **`error.schema.json` gains `error_data`** as a discriminated union keyed on its inner `kind`, starting with `interrupted-sync`, and documents exit code `98` alongside the `1` and `99` already there. This is what makes the 6.5 banner typed.
3. **The fixtures in 2.10.**

### 2.6 Version guard (`cli/versionGuard.ts`)

- **`program.version`: `>= 0.9.0, < 0.10.0`.** Claim only what is tested. `0.10.0` is the next breaking release and will hard-block the extension until someone re-pins and tests; the ceiling message must read as deliberate, and re-pinning belongs in the release checklist for every CLI minor.
- **`message.version`:** per kind, accept a matching major and any minor at or above the one the generated types were built from. A higher major hard-blocks that command. It is a **string** and differs per kind: `status`, `history`, `changeinfo`, `goto`, `sync`, `revert`, `resume`, `doctor`, and `init` are `"1.0"`; `error` is `"1.1"`. Seed the table with those, compare parsed components, and keep the table next to the generated types so a schema bump is a one-line diff.
- Semver parse tolerating prerelease and build suffixes. Distinct messages below floor (upgrade the CLI) and at or above ceiling (upgrade the extension).
- **Below floor, offer an action running `fxv upgrade -y`** in a terminal rather than only naming the problem, gated on platform: release binaries are Windows x86_64 only today, and a button that can only fail is worse than none. Elsewhere, link to install instructions.
- Cache the verdict, set `flexvault.cliIncompatible`, expose a reset for the settings-change path, and make the range injectable so fixture tests can assert parse behavior independently of version verdicts.

### 2.7 Revision specs (`cli/revision.ts`)

Two functions, and nothing outside this module builds a revision string:

- `specFromCommitInfo(commit): string`
- `specFromRevision(branch, revision, draftRevision?): string`

Always take the branch from the payload; never assume `main`.

**A missing published revision is written as `-`, not omitted.** On an unparented draft the `commitInfo` has no `revision` key at all, only `branch`, `type`, and `draft_revision`, and the spec is `main.-.1`. The CLI prints that form, `cat -r` and `changeinfo` accept it, `goto` returns it in `target_revision`, and `workspace_sync.schema.json` documents it. A naive template yields `main.undefined.1`. Round-trip both directions in the unit tests, alongside the non-`main` branch case.

### 2.8 Lock contention (`cli/lockErrors.ts`)

Mutating commands exit on lock contention rather than waiting. **`status` locks too, unless `--skip-remote-update` is passed**, which skips the remote check _and_ the lock. So a plain `status` is a lock-taking command; only the `--skip-remote-update` form is contention-free.

The 2.3 queue only covers this extension's calls, not the same workspace open in Unity or Godot, a `fxv` in the integrated terminal, or a stale lock from a crash.

Contention is exit 99 with the holder named in the message:

```
Workspace is locked by another process (PID: 9300, Command: '...\fxv.exe workspace hold-lock 10 ...', Timestamp: ...).
```

Parse the holder's command line out so the notification can name the application rather than saying "another application". Surface with a **Retry** action, and offer `fxv doctor --fix` as a secondary action for a genuinely abandoned lock. Never run `--fix` unprompted.

### 2.9 Command surface (`cli/commands.ts`)

One typed function per subcommand. The runner, not the caller, picks `runJson()` or `runRaw()`.

| Function           | Argv                                                      | Envelope                       |
| ------------------ | --------------------------------------------------------- | ------------------------------ |
| `status`           | `status [--skip-remote-update] [--skip-scan]`             | yes                            |
| `snapshot`         | `snapshot [-d <description>]`                             | error only                     |
| `publish`          | `publish [-d <description>]`                              | error only                     |
| `sync`             | `sync [<revision-spec>]`                                  | yes                            |
| `goto`             | `goto <revision-spec>`                                    | yes                            |
| `revert`           | `revert (<path>... \| --all [--force])`                   | yes                            |
| `resolve`          | `resolve (--mine\|--theirs\|--undo) (<path>... \| --all)` | yes                            |
| `history`          | `history [-n <count>] [-b <branch>]`                      | yes                            |
| `changeinfo`       | `changeinfo <revision-spec> [-a] [-e]`                    | yes                            |
| `cat`              | `cat [-r <revision-spec>] <path>`                         | no, raw bytes, `runRaw()` only |
| `resume`           | `resume [--continue\|--rollback] [--full]`                | yes                            |
| `doctor`           | `doctor [--fix]`                                          | yes                            |
| `login` / `logout` | `login <username>` / `logout`                             | yes                            |

Easy to get wrong:

- **Never pass an empty `-d`.** `snapshot -d ""` hard-errors with "Prompting for a snapshot description is not supported yet". Omit the flag. This matters because 4.3 prefers the SCM input box, which is empty by default.
- `revert` and `resolve` take paths or `--all`, mutually exclusive at the clap level.
- `changeinfo` defaults to changed files only, which is what 5.4 wants. `-a` and `-e` are not exposed in v1.
- `resume` and `doctor` are the recovery path for 2.3 and 2.8, not extras.

**Deliberately not wrapped:** `init`, `clone`, `upgrade` (except the 2.6 action), `diff`, `branch`, `user`, `repository`, `workspace`, `git`, `p4`, `rpc`. `clone` and `branch` are deprecated/WIP upstream. `diff` has no JSON surface and drives an external diff tool, so Phase 5 builds on `cat` instead. `init` is a provisioning step carrying the S3 auth flags, not an editor action.

### 2.10 Fixtures

Added upstream in `fxv-api-rs`, no private copies here, regenerated at `0.9.0`:

- **One per kind, not one for the family:** `sync.json`, `goto.json`, `revert.json`. They share a payload schema but not a `kind` or a version line, and only `revert` carries `created_revisions`.
- `resolve.json`, once its success payload is known.
- `login.json`.
- An `interrupted-sync` error fixture, which is what pins the 6.5 banner and the `error_data` handling.
- `status` variants for a conflict, a `parented_draft` with `sync_status`, and an `unparented_draft` whose `commitInfo` has no `revision` key, which pins the `-` spec handling.

The existing `status.json` carries `program.version: "0.4.0"`, below any floor this extension pins, which is why the guard must be injectable in tests (2.6). Assert version rejection in its own dedicated test.

**Hard prerequisite for Phase 3,** paired with the 2.5 schema PRs: the conflict fixture must exercise whatever shape the schema PR defines.

**Done when:** unit tests cover discovery on all three platforms (mocked fs), envelope parsing including the multi-object fallback, the exit-code classification table, both version guards at their boundaries, revision-spec round trips on a non-`main` branch and on the `-` form, read-timeout kill, and write-timeout non-kill.

---

## Phase 3: Source Control provider

### 3.1 Register (`scm/provider.ts`)

`vscode.scm.createSourceControl("flexvault", "FlexVault", rootUri)`. Set `inputBox.placeholder` to a description prompt, wire `acceptInputCommand` to publish, disable the input box while `flexvault.busy`, and set `sourceControl.count` from `file_change_counts.total` for the activity bar badge.

### 3.2 Resource groups (`scm/resources.ts`)

Three groups:

- **Conflicts** (`conflict_state` present). Listed first, blocks publish, `hideWhenEmpty: true`.
- **Unpublished** (`unpublished_state` present): snapshotted, not published.
- **Workspace** (`workspace_state` present): changed on disk, not snapshotted.

The mapping is a fan-out, not a partition:

```
for each file in status.files:
    if file.conflict_state:    conflicts.push(resource(file, CONFLICT))
    if file.unpublished_state: unpublished.push(resource(file, file.unpublished_state))
    if file.workspace_state:   workspace.push(resource(file, file.workspace_state))
```

A file with changes on both axes appears in both Unpublished and Workspace. **Do not deduplicate:** that is how a user sees they have snapshotted changes plus further unsnapshotted ones. Pin the exact expectation in the mapping test.

`file_change_counts` reports `total`, `unpublished`, and `workspace_need_snapshot`, with no conflict count. Derive the conflict count by counting `conflict_state` entries, and do not expect the three group sizes to sum to `total`.

### 3.3 Decorations (`scm/resources.ts`, `scm/decorations.ts`)

Map `changeKind` to badges following VS Code's Git conventions: `added` to `A`, `modified` to `M`, `deleted` to `D`, `maybe_changed` to `M` with a muted tooltip noting it may be unchanged (it only arises on the workspace axis). Conflicted is `!` in the conflict color. Deleted resources get `strikeThrough: true` and are not click-to-open.

`vscode.FileDecorationProvider` puts the same badges in the Explorer, propagating to parent folders the way Git does.

### 3.3a Conflict detail (gated on the 2.5 schema PR)

Once `conflict_state` has a real shape, render a tooltip and detail view naming what the conflict is between, so a user choosing Keep Mine or Take Theirs can see what they are choosing. Build against generated types only. If the schema PR has not landed when the rest of Phase 3 is done, ship without this section rather than walking an untyped object; the badge and the resolve commands do not depend on it.

### 3.4 Status refresh (`state/statusCache.ts`)

A single in-memory snapshot of the last `status` payload, keyed by path. Debounced by `refreshDebounceMs` and triggered by `onDidSaveTextDocument`, `createFiles` / `deleteFiles` / `renameFiles`, the file watcher, the manual refresh command, and every mutating command. Coalesce overlapping refreshes; never let two `status` calls stack.

**The debounced refresh always passes `--skip-remote-update`, and this is a correctness requirement, not an optimization.** That flag is what skips the workspace lock (2.8); without it a background refresh takes the lock and can both fail against and block a mutation running in another application. The full `status` is reserved for the explicit refresh command, activation, and the sync view, runs through the mutation queue rather than beside it, and surfaces lock contention the same way a write does.

**Watcher scoping** decides whether this extension is usable on a game-asset repo. A naive `**/*` watcher there watches hundreds of thousands of files:

- Create the watcher with a `RelativePattern` rooted at the FlexVault root, not the workspace folder.
- Exclude `.fxv_workspace/**` unconditionally. The CLI writes there constantly and every write would trigger a refresh of itself.
- Read `.fxvignore` at activation and on change and exclude its entries. Honor `files.watcherExclude` and `flexvault.watchExclude`.
- Narrow event kinds where a workspace event already covers them (`createFiles`, `deleteFiles`).
- The watcher is an optimization, not a correctness requirement: if `watchEnabled` is false or an event is missed, the manual refresh and post-mutation refresh still converge.

A refresh must never block the UI thread, and a slow one must not stall the queue.

**Done when:** editing, adding, and deleting files updates the SCM view and Explorer badges without a manual refresh, on a non-`main` branch, and the watcher stays quiet during a `goto` across a large directory.

---

## Phase 4: Commands

### 4.1 Publish is a flow, not a command

1. Refuse while conflicts exist.
2. Refuse while logged out, offering `flexvault.login`. `publish` requires a logged-in user; draft-side operations do not.
3. `snapshot`. On failure, stop and report; nothing has changed.
4. If `sync_status` is present and `up_to_date` is false, confirm, then `sync`. On failure, report that the snapshot succeeded and the changes are safe as an unpublished draft.
5. If the sync produced conflicts, stop and route to the Conflicts group. Do not publish.
6. `publish`. On failure, report that the snapshot succeeded locally and the changes remain an unpublished draft.

The partial-failure messaging in steps 4 and 6 is the point of the flow; it is where all the user confusion lives. Steps 3 and 6 get a real message from the failure envelope (ground rule 4), so the text can quote the CLI rather than saying "publish failed, see the log". If step 2 is somehow bypassed, `publish` returns `Workspace error: No user is logged in to this workspace; run 'fxv login <username>' before publishing` as a structured envelope.

### 4.2 Authentication

**`fxv login` takes a username and nothing else.** There is no password, token, or interactive prompt; the CLI's own help says "There is no authentication yet - this just records who commits/publishes should be attributed to." Login is a `showInputBox` for the username, an envelope-returning command, and a status refresh.

- No credential is stored, so `SecretStorage` holds nothing in v1 (1.5).
- `logout` is local and synchronous and reports the previously logged-in user in its envelope, which is what the confirmation should quote.
- Offer the last-used username as the input box default, from `workspaceState`.

### 4.3 Rules

- Every mutating command runs under `vscode.window.withProgress` on the SCM location. These bars are **indeterminate**: the CLI prints one final envelope with no interim output. Say "Publishing…" and mean it; do not fake a percentage.
- Destructive commands (`revert`, `resolve --theirs`, `goto`) use `showWarningMessage({modal: true})`, never a toast. The CLI snapshots the workspace before `revert` and `goto`, so the copy should say "your current state is snapshotted first" rather than implying data loss.
- Prefer the SCM input box for the publish description over `showInputBox`, matching Git. If both are empty, omit `-d` entirely (2.9).
- Every mutating command consults `state/safetyGuards.ts` first (6.4) and refreshes status after.

**Done when:** a full edit, snapshot, publish, sync round trip works without leaving the editor, including the behind-remote path and the logged-out path.

---

## Phase 5: Diff and history

### 5.1 Content provider (`providers/contentProvider.ts`)

A `TextDocumentContentProvider` for the `fxv:` scheme. Resolving `fxv:/path?revision=<spec>` calls `runRaw()` with `fxv cat -r <spec> <path>`. No `--format json` on this call; it errors. The query carries a revision **spec**, built through `cli/revision.ts`.

`TextDocumentContentProvider` returns a string, so detect binary content (NUL byte in the first few KB) and return a readable placeholder rather than mojibake. `cat` is byte-exact through the pipe on Windows, so the binary check is the only thing standing between a user and a corrupted diff view.

### 5.2 Quick diff and the content cache (`scm/quickDiff.ts`)

Set `sourceControl.quickDiffProvider` to resolve a file to its published base from `head_commit.published_head`, lighting up the gutter indicators.

The gutter provider asks repeatedly and a single asset can be hundreds of megabytes, so the cache is **on disk, not in memory**:

- Keyed by (path, revision spec), which is immutable, under `context.globalStorageUri`.
- Capped by total bytes at `contentCacheSizeMB`, LRU eviction enforced on write.
- A small in-memory layer in front for text files only, bounded well below the disk cap.
- Purged on activation when the cache version marker does not match. `flexvault.clearCache` purges on demand.
- Files over a size threshold skip the cache and stream through.

### 5.3 Diff command

`flexvault.diffAgainstBase` opens `vscode.diff(fxvUri(base), fileUri, title)` and is the default click action for a resource, matching Git.

The useful base differs by axis: diff the workspace axis against the local snapshot, and the unpublished axis against the published head, falling back to the local snapshot when there is no published revision (unparented draft or new branch).

### 5.4 History view (`providers/historyTree.ts`)

A `TreeView` in the SCM container listing `history -n <historyLimit>`: description, author display name, relative timestamp, revision.

`author_details` is a tagged union with six variants (`Local`, `Service`, `FxvUser`, `GitUser`, `P4User`, `Error`) discriminated on `type`. Use `author_display_name` as the label and reserve the union for the tooltip; the `Error` variant must not render as a username. `description` is optional and absent when a commit was made without one. `commit_hash` is omitted from `history` entries, so key nothing on it here.

Per-entry actions: **Show changes** (`changeinfo <spec>` as child nodes, each opening a diff), **Go to revision** (modal confirm), **Copy revision** (the spec string).

The Timeline API is not used in v1: it gives per-file history where the primary need is branch-level, and it would cost a per-file call shape the CLI does not have.

**Done when:** a user can inspect any past revision's changes and diff them inline, on a non-`main` branch, with a binary file in the change set.

---

## Phase 6: Sync status and safety

### 6.1 Status bar (`ui/statusBar.ts`)

Branch, revisions behind when `sync_status.up_to_date` is false, and logged-out state. Clicking runs sync.

`sync_status` is present only for a parented draft with a known synced revision and is otherwise explicit `null`; `synced_revision` is additionally nullable within it. Handle absence rather than defaulting to zero.

### 6.2 Head state

`head_commit.state` is a three-way union (`empty_branch`, `unparented_draft`, `parented_draft`) whose `oneOf` means fields differ per variant. Only `parented_draft` carries `published_head`, so quick-diff falls back per 5.3 on the other two. Drive affordances off `flexvault.headState`; a fresh `empty_branch` workspace shows the onboarding welcome view, not an empty list.

### 6.3 Authentication state

Gate publish on it and surface it in the status bar. `status.current_user` is explicit `null` when logged out, not omitted, so test for nullish rather than for the key.

### 6.4 Safety guards (`state/safetyGuards.ts`)

- Block mutating operations while there are dirty editors under the root. Offer "Save all and continue".
- Block while a debug session is active: a `sync` or `goto` can pull files out from under a running process.
- Block concurrent mutations via the 2.3 queue; handle cross-application contention via 2.8.

### 6.5 Interrupted-operation recovery (`state/recovery.ts`)

`sync`, `goto`, `revert`, and `resolve` leave a journal if interrupted, and the workspace is inconsistent until `fxv resume` finishes or rolls it back.

**Detection is free and exact: any `status` returning exit 98** carries `error_data` of kind `interrupted-sync`. No separate probe is needed, because the debounced refresh already asks the question every time.

- On detection, set `flexvault.interrupted` and block mutating commands.
- **Build the banner from `error_data.payload`, not by parsing the message.** It carries `operation`, `completed_entries`, `remaining_entries`, `failed_entries`, `preserved_entries`, and `sampled_unfinished_paths`, enough to say "A `goto` was interrupted: 2 of 6 file changes applied, 4 remaining" and name the affected files.
- Offer **Finish** (`resume --continue`) and **Undo** (`resume --rollback`). `resume` returns a `kind: "resume"` envelope with the workspace-sync payload shape, so reporting the outcome reuses the `goto` and `sync` path.
- `resume --full` and `doctor reset-sync` are last resorts. Do not surface `reset-sync` in the UI; point at the CLI. It discards the journal, and that is not a button.

### 6.6 Error surfacing (`ui/log.ts`)

One output channel, `FlexVault`, logging every invocation (argv, exit code, duration) and full stderr on failure, at `logLevel`. User-facing failures show a short message plus **Show Log**. Never dump raw stderr into a toast.

**Redact sensitive argv before logging.** Mirror `SENSITIVE_LONG_FLAGS` (`--s3-access-key-id`, `--s3-secret-access-key`), which the CLI already redacts from `program.arguments`. v1 does not call `init`, so this is cheap insurance rather than a live exposure, but the list is worth mirroring now.

---

## Phase 7: Deferred

Ordered by value, none blocking v1:

1. **Progress streaming.** Blocked upstream: nothing emits interim messages, and the format (spelled `json-l`) panics rather than erroring, exiting 127. Never pass it. The 2.4 parser is already shaped to accept interim messages when they arrive.
2. **Ignore management.** `flexvault.ignoreSelected` appending to `.fxvignore`.
3. **Walkthrough.** First-run setup: locate CLI, log in, open a workspace.
4. **Branch switching.** Blocked upstream; `CmdBranch` is deprecated/WIP.
5. **Multi-root workspaces.**
6. **Read path over `fxv rpc`.** `status` and `history` have RPC handlers and are what the debounce hits hardest; ground rule 2 contains the change to `src/cli/`. Measure the win (process startup plus workspace load per refresh) before taking on a long-lived child and its lifecycle.
7. **Timeline provider** for per-file history, alongside 5.4.
8. **Diagnostics view** over `doctor`'s structured `checks` array (`id`, `group`, `name`, `status`, `detail`).
9. **Remote compatibility audit** over Remote SSH and dev containers.

---

## Phase 8: Testing and release

### 8.1 Unit tests

Pure logic, no VS Code host: discovery, envelope parsing and exit-code classification, both version guards, revision-spec conversion, status-to-group mapping, argv construction (the empty-description carve-out and the three no-JSON-success commands), context-key derivation. Run against `fxv-api-rs/tests/fixtures/*.json` with the version guard injected.

### 8.2 Integration tests

`@vscode/test-electron` against a scratch workspace created by **`fxv init --local-only`**. No server dependency, so the suite runs anywhere without provisioned infrastructure.

Covered:

- `cat` on a binary file through the content provider, asserting byte equality.
- The `main.-.N` unparented-draft spec, which is the default state of a local-only workspace.
- Lock contention: hold it with `fxv workspace hold-lock <seconds>` and assert the exit-99 path surfaces the 2.8 notification with the holder named.
- Interrupted-operation recovery: `--debug-fail-sync-after` applies to `goto`, not only to a remote sync, so the whole cycle runs local-only. A `goto --debug-fail-sync-after 2` exits 127, the next `status` exits 98 with a typed `interrupted-sync` payload, and `resume --continue` recovers.
- Groups, decorations, refresh, snapshot, revert, and history.
- An untrusted workspace: assert the extension does not spawn.

**Not covered, knowingly:** `publish` in any form including the 4.1 behind-remote flow; `sync` doing real work (local-only `sync` succeeds with zero files, exercising the envelope but not the operation); and conflicts end to end, so the Conflicts group, the resolve commands, and 3.3a rest on fixtures and manual testing. Keep a written manual test script for the publish and conflict paths and run it before each release. This raises the stakes on the 2.10 conflict fixtures.

CI needs `xvfb-run` on Linux for the extension host, and a matrix across Linux, macOS, and Windows; discovery and path handling differ per platform and Windows is the primary target.

When testing against a locally built CLI, invoke `fxv-core/target/debug/fxv.exe` explicitly per the workspace `AGENTS.md` convention, and confirm it is current: that build was last seen at `0.8.0` while the source tree was `0.9.0`.

### 8.3 Release

**Publisher identity does not exist and is on the critical path.** In order:

1. Azure DevOps organization, then a PAT scoped to Marketplace publish.
2. VS Code Marketplace publisher `flexvault`, matching `package.json`.
3. Open VSX namespace `flexvault`, with its own token.
4. CI secrets `VSCE_PAT` and `OVSX_PAT` on `FlexVaultSCM/fxv-vscode-plugin`.

Then `vsce package` on every PR, `vsce publish` on a release-please tag, to both Marketplace and Open VSX. State the supported CLI range (`>= 0.9.0, < 0.10.0`) in the README.

---

## Open questions

Two, both answerable during Phase 2 and neither blocking a start:

- **The `conflict_state` field set,** from the Rust type the CLI serializes. Ours to determine in the schema PR (2.5).
- **`resolve`'s success payload and `kind`.** Needs a real conflict, which 8.2 puts outside the automated suite, so capture it by hand while writing the conflict fixtures.

One thing to confirm in Phase 1: whether a non-glob `workspaceContains` pattern matches a directory (1.3).

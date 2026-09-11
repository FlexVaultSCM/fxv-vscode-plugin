# Rationale

Background for `PLAN.md`. Nothing here is an instruction; it records why the plan says what it says, so the plan itself can stay short.

Two sources feed it: the three existing engine plugins (`fxv-unity-plugin`, `fxv-godot-plugin`, `fxv-unreal-plugin`) and the CLI wire format in `fxv-api-rs/schemas/`. All CLI claims were verified against `fxv-core` at `0.9.0` (`crates/fxv_cli/Cargo.toml:3`); citations are to that tree.

The general rule applied throughout: follow a decision the engine plugins already settled, unless it was a workaround for a host limitation VS Code does not have, or unless it has gone stale against the CLI.

---

## Where the engine plugins were followed

- **No SCM logic in the plugin.** Every operation maps to a CLI subcommand. All three plugins hold this line and it has kept them cheap to maintain across CLI releases.
- **One runner module.** Godot has `fxv_runner.gd`, Unity has `FxvRunner.cs`. Concentrating flag handling, envelope parsing, and version gating in one place is what made the 0.9.0 audit tractable at all.
- **Envelope discipline.** Parse `{program, message}`, check `message.kind`, then read `message.payload`. `kind: "error"` means failure regardless of exit code.
- **Binary discovery order** and the cached version verdict reset on settings change, from `fxv_settings.gd:127-181`.
- **Parent-directory walk for the workspace root** (`fxv_settings.gd:194`). The `.fxv_workspace` marker sits at the repo root, frequently a parent of the folder a user opens. Opening an engine project subdirectory of a larger repo is the common case for this product.
- **Never pass an empty `-d`.** `snapshot -d ""` hard-errors with "Prompting for a snapshot description is not supported yet" (`mod.rs:421-427`). Godot omits the flag instead, and so does the plan.
- **The full publish flow,** from `FlexVaultWindow.cs:605-681`: snapshot, then sync if behind remote, then conflict check, then publish. Its partial-failure messaging ("Snapshot created, but sync failed", "Snapshot succeeded locally, but publish failed") is the part most easily dropped and is where all the user confusion lives.
- **Per-file diff base resolution** from `FlexVaultDiffHelper.cs:44-75`, including the fallback to the local snapshot when there is no published revision.

## Where they were corrected against the current CLI

**The no-JSON commands still report failures as envelopes.** Both the engine plugins and the first draft of this plan treated `snapshot` and `publish` as opaque: exit code plus stderr, nothing structured. Running them proves otherwise. Under `--format json` a failing `snapshot` or `publish` prints a well-formed `kind: "error"` envelope to **stdout** with stderr empty, while a succeeding one prints human text and no JSON. The asymmetry is success-only, which is unusual enough that it is worth stating twice: the plan's runner attempts an envelope parse on these three and reads a parse failure at exit 0 as success. The practical gain is that publish's partial-failure messaging can quote the CLI's own error instead of pointing at a log.

**Three commands do not emit JSON on success, not two.** Godot's runner knows about `snapshot` and `publish`. `cat` is the third and it is stricter: `cmd_cat` actively rejects any non-human format, returning `cat only supports --format human, its output is the file's raw bytes` for both `Json` and `JsonL` (`crates/fxv_cli/src/commands/workspace/cat.rs:47-49`), with a test pinning the behavior. The Godot plugin only avoids this by bypassing its own runner (`fxv_runner.gd:429` calls `OS.execute` directly). The plan's `runRaw()` is that bypass made legitimate and kept inside the runner module.

**Two global flags, and Godot was right.** An earlier draft of this plan called for appending all four of `--unattended`, `--no-color`, `--no-pager`, `--no-progress` on the grounds that a non-TTY pipe wants no pager and no spinner, and treated Godot's two as an oversight. The CLI says otherwise: `main.rs:175-176` passes both of the extra flags to `message_unimplemented`, which prints `Warning: The command 'no_pager' is not implemented yet.` to stderr. Passing them buys two warning lines per invocation. `--no-progress` does have a real effect at `workspace/mod.rs:157` (the streaming human renderer) despite the warning; `--no-pager` is not read anywhere else at all. Neither is needed under `--format json`.

`--unattended` carries a second job worth knowing about: it is one of the gates on the CLI's passive update-check notice, which otherwise reads a cache synchronously and spawns a **detached background process** to refresh a stale one (`main.rs:183-215`). An extension invoking `fxv` on a debounce without it would be spawning update checkers behind the user's back. The other gates (Human output, an interactive stderr) would each catch this independently, so it is belt and braces rather than the only thing standing in the way.

**Version guarding checks two versions, not one.** `program.version` gates the binary per `fxv-core/VERSIONING.md:73-84`. `message.version` gates the wire contract actually being parsed: it is required in the envelope schema, is per-kind on its own `major.minor` track, and the schema states the major is bumped "for anything a consumer could break on." Gating only on `program.version` checks the binary and not the payload.

**The pinned range was re-derived, not copied.** Godot pins `>= 0.5.0, < 0.10.0`. The CLI is at `0.9.0`, and under `bump-minor-pre-major` on a 0.x line the next breaking release is `0.10.0`, so that range has about one minor release of headroom. Its `0.5.0` floor is also an untested claim for an extension that will be written against `0.9.x`. The plan pins `>= 0.9.0, < 0.10.0`: claim only what is tested. The accepted consequence is that `0.10.0` hard-blocks until someone re-pins and tests, which is why the above-ceiling message has to read as intentional.

**Envelope parsing does not port Godot's "first `{` to last `}`" scan as the primary path.** That scan works today only because `--format json` emits exactly one pretty-printed envelope and nothing else (`async_cli_operation.rs:89-96`). The moment a second object appears it yields `{...}{...}`, which is not valid JSON, so it fails rather than degrading. A whole-buffer parse with a brace-depth fallback subsumes Godot's leading-noise tolerance and stays correct if the CLI later interleaves progress messages or switches to NDJSON.

**Revisions are branch-qualified strings, not integers.** `main.11` published, `main.11.123` draft, per the help text on `CmdGoto`, `CmdCat`, `CmdSync`, `CmdDoctorResetSync`. Status reports them as integers in some places (`sync_status.published_head_revision`, `synced_revision`) and as structured `commitInfo` in others. This is the detail most likely to work on `main` and break silently on every other branch, which is why the plan centralizes both conversions and why several "done when" gates specify a non-`main` branch.

**Writers are never killed on timeout.** Godot's inability to kill a child is not purely a deficiency to correct. `fxv resume` exists precisely because "a sync, goto, revert or resolve interrupted before it finished" leaves the workspace inconsistent behind a sync journal (`CmdResume` doc comment), and `fxv doctor reset-sync` is the last resort when that journal cannot be read. Killing a writer mid-flight manufactures exactly that state, and on a game-asset repo a multi-minute sync is normal, not an edge case. Reads are safe to kill; writes are not. Godot's non-kill behavior is documented at `fxv_runner.gd:134-139`.

**`resume` and `doctor` are new relative to the engine plugins.** They are the recovery path that the timeout policy above requires, so they are not optional additions.

**Lock contention needs handling the plugins do not have.** Mutating commands take a workspace lock and exit the process on contention rather than waiting (`try_lock_workspace_or_exit`, `mod.rs:923-939`). An in-extension queue only serializes the extension's own calls; it does nothing about the same workspace open in the Unity or Godot plugin, a `fxv` in the integrated terminal, or a stale lock from an earlier crash.

**`status` is not automatically a safe read.** An earlier draft asserted that `status` never locks, which made the debounced refresh look contention-free by construction. The flag help is explicit that it is `--skip-remote-update` that skips the lock, not `status` itself: "This will also skip locking the workspace, so use this when you expect concurrent operations to be happening on the same workspace" (`status.rs:37-41`). Holding the lock with `fxv workspace hold-lock` and running both forms settles it: the full `status` exits 99, the `--skip-remote-update` form exits 0. This is why the plan makes `--skip-remote-update` a correctness requirement on the debounce path rather than a cheap-refresh optimization, and why the full `status` goes through the mutation queue.

**`login` has no password.** `CmdLogin` carries a single `username` field and `cmd_login` validates it against the workspace's admin database and records it (`workspace/mod.rs:362-376`). There is no credential prompt, flag, or environment variable, so there is nothing for the extension to collect, pass, or store. This is worth writing down because the shape of the command invites the opposite assumption, and an earlier draft of the plan made it: it specified a password input box, a non-argv channel to pass it through, and `SecretStorage` persistence, none of which have anything to attach to. If FlexVault auth later gains a real credential, that is when the `SecretStorage` hook the plan reserves starts carrying something.

## Where VS Code changes the answer

**Diff.** Unity and Godot shell out to an external diff tool (`FXV_DIFF_TOOL`, VS Code, Rider) because their editors have no diff view. VS Code has one, so the external-tool path is dropped entirely in favor of `vscode.diff` over an `fxv:` content provider. `fxv diff` the CLI command is not usable here: it carries `TODO: (FUTURE WORK) --format json support` (`mod.rs:148`) and renders through a diff tool of its own.

**Safety guards.** The engine plugins guard against Play Mode and unsaved scenes. The VS Code equivalents are dirty editors and active debug sessions, for the same underlying reason: a `sync` or `goto` can pull files out from under a running process.

**Transport.** The engine plugins spawn a process per command because Unity and Godot have poor subprocess ergonomics. That reasoning does not transfer to a Node host, and two things point the other way: `fxv rpc` already exists (JSON-RPC 2.0 over stdin/stdout, NDJSON framed, each method's params deserializing from the same struct clap parses argv into, so the transports cannot drift, `crates/fxv_cli/src/rpc/dispatch.rs:20-30`), and the workspace-level `IPC_INTEGRATION_PLAN.md` states the ecosystem direction is away from transient subprocesses toward a persistent `fxv-agent` daemon.

The RPC method set today is `status`, `history`, `user`, `ping`, `shutdown`, `server.info` (`RpcMethod::ALL`). That covers the read hot path but no mutating command has an RPC handler, so `publish`, `sync`, `goto`, `revert`, `resolve`, `snapshot`, `login`, and `logout` go through argv regardless. A split transport doubles the surface before anything ships, so v1 spawns per command. The constraint that makes this reversible is that the runner's public API is expressed as typed command functions returning envelopes, never as argv, so moving reads to RPC or to the `fxv-agent` socket is contained to `src/cli/`.

**Progress bars.** Under `--format json` the CLI runs to completion and prints one final envelope with no interim output (`async_cli_operation.rs:89-96`), so there is no percentage to show. The envelope schema documents interim `*-progress` messages with `sequence` and `update_frequency_seconds`, but nothing emits them and `--format jsonl` is `unimplemented!()` (`async_cli_operation.rs:98`, and again at `mod.rs:406` in `cmd_logout`). Progress stays indeterminate until that lands upstream.

**Destructive-command copy.** The CLI documents `revert` and `goto` as non-destructive: both snapshot the workspace first and preserve local modifications. The modal confirm stays because the user still loses their working state from view, but the copy should say what actually happens rather than implying data loss.

## Known gaps in the wire format

- **`fileStatus.conflict_state` is a bare `{"type": "object"}`** with no properties (`common.schema.json`). Generation yields `object`, leaving nothing typed to read beyond presence. The plan fills this upstream first rather than shipping presence-only conflict rendering.
- **Fixtures do not cover v1.** `fxv-api-rs/tests/fixtures/` holds `changeinfo.json`, `error.json`, `history.json`, `init.json`, `logout.json`, `status.json`. There is no `workspace_sync` fixture at all, and `sync`, `goto`, `revert`, and `resolve` all return that payload, so the four most important mutating commands have nothing to parse against. Nothing carries `conflict_state`, `sync_status`, `parented_draft`, or `empty_branch` either. Separately, `status.json` carries `program.version: "0.4.0"`, below any floor this extension will pin, which is why the version guard has to be injectable in tests.

## Worth raising upstream

- **`error.schema.json` does not describe the error payload the CLI emits.** A failing command can return `error_data`, a nested sub-envelope with its own `kind`, `version`, and `payload` (observed: `interrupted-sync`). The schema declares `additionalProperties: false` and does not mention it, so the CLI emits a payload its own schema forbids and any strict consumer rejects a legitimate error. The schema also documents exit codes 1 and 99 but not 98, which is the one a consumer most needs to branch on because it means the workspace needs recovery. This extension is fixing it rather than reporting it, but the other three plugins are parsing the same payload.

- **`--format jsonl` panics** rather than erroring cleanly (`async_cli_operation.rs:98`, `mod.rs:406`). Any consumer that passes it gets a Rust panic. A clean "not supported" error costs little.
- **No consumer implements the `program.version` check** (`VERSIONING.md:81-84`). This extension is the first. Its guard, including the distinct upgrade-the-CLI and upgrade-the-extension messages, is worth promoting into shared guidance for the other three plugins.

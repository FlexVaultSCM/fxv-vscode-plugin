<p align="center">
  <img src="media/icon.png" width="128" alt="FlexVault Logo" />
</p>

<h1 align="center">FlexVault for Visual Studio Code</h1>

<p align="center">
  Visual Studio Code source control integration for <a href="https://fxv.dev">FlexVault</a>. Drives the <code>fxv</code> CLI from your editor.
</p>

<p align="center">
  <a href="https://fxv.dev">Website</a> ·
  <a href="https://docs.fxv.dev">Documentation</a> ·
  <a href="https://discord.gg/KCMHRQBDf">Discord Community</a>
</p>

---

## Overview

FlexVault is a version control system designed for game development and binary assets. This extension integrates FlexVault into Visual Studio Code's Source Control panel, gutter diffs, and editor workflows.

## Features

### Source control management

Files appear in the Source Control panel across three groups:

- Conflicts: Unresolved merge conflicts, noting content differences, deletion clashes, or file and directory type changes.
- Unpublished: Snapshotted revisions waiting to publish to your branch.
- Workspace: Unsaved or unsnapshotted disk modifications.

Status updates automatically on file save, creation, deletion, and rename. Background updates pass `--skip-remote-update` to avoid acquiring workspace locks. The extension respects `.fxvignore` patterns.

### Publish workflow

The publish action runs from the SCM panel or the Command Palette. It verifies authentication, snapshots open changes, checks if the local branch is behind remote revisions, synchronizes changes, and publishes. If a remote sync produces conflicts, publishing pauses and routes the conflicting files to the Conflicts group.

### Conflict resolution

Conflict actions are accessible directly on items in the Conflicts group:

- Resolve (Keep Mine): Keeps local modifications.
- Resolve (Take Theirs): Accepts target changes.
- Resolve (Undo): Clears the chosen resolution to re-examine the conflict.

### Diffs and editor gutters

The extension provides side-by-side diffs against the published base revision or local snapshot. Gutter decorations indicate modified, added, and deleted lines through the `fxv:` content provider. An LRU disk and memory cache stores diff contents for binary and text assets.

### Revision history

The FlexVault History view in the SCM container lists past commits with author attribution, timestamps, and commit descriptions. Revisions expand to display changed files, which open in comparison diffs on click. Context actions allow switching to past revisions or copying revision specs.

### Interrupted operation recovery

If a sync or navigation command is interrupted (CLI exit code 98), the extension detects the journal state and displays a recovery banner. You can select Finish (`fxv resume --continue`) or Undo (`fxv resume --rollback`).

### Status bar and safety checks

The status bar displays the active branch, revisions behind remote, and current user attribution. Clicking the status bar triggers a sync. Operations refuse to run when open editors have unsaved changes or while a debug session is active.

---

## Prerequisites

- **VS Code**: Version `1.85.0` or newer.
- **FlexVault CLI**: `fxv` (version `0.9.0` or newer, compatible up to `< 0.11.0`).
  - The CLI must be accessible on your system `PATH` or configured via the `flexvault.cliPath` setting.
  - On Windows, install via the official installer; on macOS/Linux, install via standard package paths or Cargo.

---

## Extension Settings

This extension contributes the following settings under `flexvault.*`:

| Setting                         | Type       | Default  | Description                                                                                                                      |
| :------------------------------ | :--------- | :------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `flexvault.cliPath`             | `string`   | `""`     | Absolute path to the `fxv` binary. Machine scope.                                                                                |
| `flexvault.readTimeoutSeconds`  | `number`   | `60`     | Timeout for read-only CLI commands (`status`, `history`, `cat`). Set to `0` to disable.                                          |
| `flexvault.writeTimeoutSeconds` | `number`   | `0`      | Timeout for mutating commands (`sync`, `goto`, `revert`). Defaults to `0` (disabled) to avoid terminating operations mid-flight. |
| `flexvault.refreshDebounceMs`   | `number`   | `300`    | Coalescing debounce interval for automatic background status refreshes.                                                          |
| `flexvault.watchEnabled`        | `boolean`  | `true`   | Enable or disable the file system watcher.                                                                                       |
| `flexvault.watchExclude`        | `string[]` | `[]`     | Additional glob patterns excluded from the status watcher.                                                                       |
| `flexvault.contentCacheSizeMB`  | `number`   | `512`    | Maximum size in megabytes for the on-disk `cat` diff content cache.                                                              |
| `flexvault.historyLimit`        | `number`   | `50`     | Maximum number of revisions to fetch in the History tree view.                                                                   |
| `flexvault.logLevel`            | `string`   | `"info"` | Output channel log verbosity (`off`, `error`, `info`, `debug`).                                                                  |

---

## Available Commands

Access these commands from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                                      | Identifier                    | Description                                                   |
| :------------------------------------------- | :---------------------------- | :------------------------------------------------------------ |
| **FlexVault: Refresh**                       | `flexvault.refresh`           | Manually refresh workspace status.                            |
| **FlexVault: Snapshot**                      | `flexvault.snapshot`          | Create a draft snapshot of workspace changes.                 |
| **FlexVault: Publish**                       | `flexvault.publish`           | Run the safe publish flow to publish changes.                 |
| **FlexVault: Sync**                          | `flexvault.sync`              | Synchronize workspace with the current published branch head. |
| **FlexVault: Go to Revision...**             | `flexvault.goto`              | Switch the workspace to a specific revision spec.             |
| **FlexVault: Revert**                        | `flexvault.revert`            | Revert selected files or workspace changes.                   |
| **FlexVault: Log In...**                     | `flexvault.login`             | Set the active user attribution.                              |
| **FlexVault: Log Out**                       | `flexvault.logout`            | Clear user attribution.                                       |
| **FlexVault: Clear Content Cache**           | `flexvault.clearCache`        | Clear the local diff cache.                                   |
| **FlexVault: Show Log**                      | `flexvault.showLog`           | Open the FlexVault output channel with redacted logs.         |
| **FlexVault: Documentation**                 | `flexvault.openDocumentation` | Open FlexVault documentation.                                 |
| **FlexVault: Feedback & Support on Discord** | `flexvault.reportFeedback`    | Open the FlexVault Discord.                                   |

---

## Development

To build and test the extension locally:

```sh
npm install
npm run watch
```

Press `F5` in VS Code to open the Extension Development Host.

| Script                     | Purpose                                                      |
| :------------------------- | :----------------------------------------------------------- |
| `npm run build`            | Bundle production code into `dist/extension.js` via esbuild. |
| `npm run compile`          | TypeScript type-check (`tsc --noEmit`).                      |
| `npm run lint`             | ESLint check across source files and scripts.                |
| `npm run format`           | Prettier check (`npm run format:write` to format).           |
| `npm run test:unit`        | Run Vitest unit tests.                                       |
| `npm run test:integration` | Run extension host integration tests in VS Code.             |
| `npm run package`          | Package into a local `.vsix` bundle.                         |

---

## Feedback & Support

Bug reports, feature requests, and questions are welcome on the [FlexVault Discord](https://discord.gg/KCMHRQBDf). You can also run the **FlexVault: Show Log** command and include log output when reporting issues.

## License

MIT. See [LICENSE.md](LICENSE.md).

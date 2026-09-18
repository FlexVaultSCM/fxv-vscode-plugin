<p align="center">
  <img src="media/icon.png" width="128" alt="FlexVault Logo" />
</p>

<h1 align="center">FlexVault for Visual Studio Code</h1>

<p align="center">
  Visual Studio Code source control integration for <a href="https://fxv.dev">FlexVault</a>. Drives the <code>fxv</code> CLI directly from your editor.
</p>

<p align="center">
  <a href="https://fxv.dev">Website</a> ·
  <a href="https://docs.fxv.dev">Documentation</a> ·
  <a href="https://discord.gg/KCMHRQBDf">Discord Community</a>
</p>

---

## Overview

FlexVault is a modern, high-performance version control system designed for game development and large binary assets. This extension integrates FlexVault directly into Visual Studio Code's Source Control panel, gutter diffs, and editor workflows.

## Features

- **Integrated Source Control Management (SCM):**
  - View changes organized into three dedicated groups:
    - **Conflicts:** Unresolved merge conflicts, highlighted with clear descriptions (content clashes, deleted files, and file/directory type changes).
    - **Unpublished:** Snapshotted changes waiting to be published to your branch.
    - **Workspace:** Real-time un-snapshotted modifications on disk.
  - Automatic status updates on file save, creation, deletion, and rename, with background lock prevention (`--skip-remote-update`).
  - Strict `.fxvignore` honor and path filtering.

- **Reliable Publish Pipeline:**
  - One-click publish flow from the SCM panel or Command Palette.
  - Automated safety steps: verifies conflict-free state, ensures active user authentication, creates draft snapshots, performs behind-remote checks, and synchronizes upstream changes before publishing.
  - Informative partial-failure reporting keeping unpublished drafts safe on failure.

- **Conflict Resolution:**
  - Contextual conflict actions directly within the Conflicts group:
    - **Resolve (Keep Mine)**: Keep local modifications.
    - **Resolve (Take Theirs)**: Accept remote or target changes.
    - **Resolve (Undo)**: Revert resolution to re-inspect conflicts.
  - Informative tooltips and badges detailing conflict types.

- **Diffs & Editor Gutters:**
  - Interactive side-by-side diffing against the published base revision or local snapshot.
  - Real-time gutter decorations (`quickDiffProvider`) powered by a custom `fxv:` content provider.
  - Built-in LRU disk and memory content cache designed to handle large assets without slowing down the editor.

- **Revision History View:**
  - Dedicated FlexVault History tree view in the Source Control container.
  - Browse past commits, author attribution, relative timestamps, and commit descriptions.
  - Expand revisions to inspect changed files and open instant side-by-side diffs.
  - Fast context actions: **Go to Revision...** and **Copy Revision Spec**.

- **Interrupted Operation Recovery:**
  - Automatic detection of interrupted synchronization or navigation operations (CLI exit code 98).
  - High-visibility notification banners parsing structured recovery journals.
  - Single-click **Finish** (`fxv resume --continue`) and **Undo** (`fxv resume --rollback`) actions.

- **Status Bar & Safety Protections:**
  - Status bar item showing the active branch, revisions behind remote, and authentication status. Click to sync.
  - Safeguards prevent destructive or mutating operations while unsaved dirty editors exist or during active debug sessions.

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

# FlexVault VS Code Extension (`fxv-vscode-plugin`)

Visual Studio Code source control integration for [FlexVault](https://fxv.dev). Drives the `fxv` CLI from the editor.

[Website](https://fxv.dev) · [Documentation](https://docs.fxv.dev) · [Discord](https://discord.gg/KCMHRQBDf)

> **Status: scaffolding.** The extension installs, activates, and writes to its output channel. No source control functionality is wired up yet.

---

## Requirements

- **VS Code**: 1.85.0 or newer.
- **Node.js**: 20 or newer, for development.
- **FlexVault CLI**: `fxv` **0.9.0 or newer, below 0.10.0**, on `PATH` or at `flexvault.cliPath`.

The CLI range is a tested range rather than a guess, so the extension blocks rather than guessing on either side of it: below the floor it asks you to update the CLI, and at or above the ceiling it asks you to update the extension, which is where support for a newer CLI arrives.

---

## Development

```sh
npm install
npm run watch      # esbuild, incremental
```

Press `F5` to launch the Extension Development Host with the extension loaded.

| Command                    | What it does                                         |
| -------------------------- | ---------------------------------------------------- |
| `npm run build`            | Production bundle to `dist/extension.js`.            |
| `npm run compile`          | Type check only, no emit.                            |
| `npm run lint`             | ESLint over `src/`.                                  |
| `npm run format`           | Prettier check; `npm run format:write` to fix.       |
| `npm run test:unit`        | Vitest, no editor host.                              |
| `npm run test:integration` | Downloads VS Code and runs the extension host tests. |
| `npm run package`          | Builds `flexvault-vscode.vsix`.                      |

On Linux the integration tests need a display. CI runs them under `xvfb-run`.

### The sibling schema repository

`src/cli/types.generated.ts` is generated from the JSON schemas in [`fxv-api-rs`](https://github.com/FlexVaultSCM/fxv-api-rs), and the unit suite parses the envelopes captured under its `tests/fixtures/`. Neither is copied in here: a private copy is a second thing to keep current, and the point of testing against captured envelopes is that they are bytes the CLI really wrote.

Check `fxv-api-rs` out next to this repository, or point the two environment variables elsewhere:

```sh
npm run types:generate   # FXV_SCHEMAS_DIR=/path/to/fxv-api-rs/schemas
npm run test:unit        # FXV_FIXTURES_DIR=/path/to/fxv-api-rs/tests/fixtures
```

CI checks the repository out and fails if the committed types differ from what the schemas generate, so a wire-format change lands as a red build rather than as a bug in the field.

---

## Feedback & Support

Bug reports, questions, and feedback are welcome on the [FlexVault Discord](https://discord.gg/KCMHRQBDf). The extension exposes the same links in the Command Palette:

| Command                                      | Opens                                                    |
| -------------------------------------------- | -------------------------------------------------------- |
| **FlexVault: Feedback & Support on Discord** | [discord.gg/KCMHRQBDf](https://discord.gg/KCMHRQBDf)     |
| **FlexVault: Documentation**                 | [docs.fxv.dev](https://docs.fxv.dev)                     |
| **FlexVault: Open FlexVault Website**        | [fxv.dev](https://fxv.dev)                               |
| **FlexVault: Show Log**                      | The FlexVault output channel. Attach it to a bug report. |

---

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). release-please reads them to cut releases.

## License

MIT. See [LICENSE.md](LICENSE.md).

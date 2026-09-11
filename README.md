# FlexVault VS Code Extension (`fxv-vscode-plugin`)

Visual Studio Code source control integration for [FlexVault](https://fxv.dev). Drives the `fxv` CLI from the editor.

[Website](https://fxv.dev) · [Documentation](https://docs.fxv.dev) · [Discord](https://discord.gg/KCMHRQBDf)

> **Status: scaffolding.** The extension installs, activates, and writes to its output channel. No source control functionality is wired up yet.

---

## Requirements

- **VS Code**: 1.85.0 or newer.
- **Node.js**: 20 or newer, for development.
- **FlexVault CLI**: `fxv` on `PATH`. Not yet used by the extension.

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

---

## Layout

```text
src/
  extension.ts        activate / deactivate; wiring only
  links.ts            canonical FlexVault URLs
  ui/log.ts           the output channel
  test/unit/          Vitest, pure logic
  test/integration/   extension host tests
```

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

# CHANGELOG

## [0.3.0](https://github.com/FlexVaultSCM/fxv-vscode-plugin/compare/v0.2.0...v0.3.0) (2026-09-18)


### Features

* implement diff against base, quick diff, and content cache ([#11](https://github.com/FlexVaultSCM/fxv-vscode-plugin/issues/11)) ([5d45a89](https://github.com/FlexVaultSCM/fxv-vscode-plugin/commit/5d45a891ae01e83be83f7cc808509d7f14df474f))
* implement SCM mutation commands and publish flow ([#10](https://github.com/FlexVaultSCM/fxv-vscode-plugin/issues/10)) ([178d068](https://github.com/FlexVaultSCM/fxv-vscode-plugin/commit/178d068a4b65c7a711145bd9be8e138660569078))
* implement source control provider and status caching ([#9](https://github.com/FlexVaultSCM/fxv-vscode-plugin/issues/9)) ([a4c70c6](https://github.com/FlexVaultSCM/fxv-vscode-plugin/commit/a4c70c6a0abda2b011d52fc9fb6cf5a81218f482))

## [0.2.0](https://github.com/FlexVaultSCM/fxv-vscode-plugin/compare/v0.1.0...v0.2.0) (2026-09-12)


### Features

* locate the fxv binary ([#3](https://github.com/FlexVaultSCM/fxv-vscode-plugin/issues/3)) ([0839a38](https://github.com/FlexVaultSCM/fxv-vscode-plugin/commit/0839a385778b253d956bedccefa0c835b24ab1d5))
* run fxv commands through a typed runner ([#4](https://github.com/FlexVaultSCM/fxv-vscode-plugin/issues/4)) ([752c998](https://github.com/FlexVaultSCM/fxv-vscode-plugin/commit/752c9989d9de82dc2525fb4ada47c5ed0f1e17ec))
* scaffold the VS Code extension ([#2](https://github.com/FlexVaultSCM/fxv-vscode-plugin/issues/2)) ([b6528f6](https://github.com/FlexVaultSCM/fxv-vscode-plugin/commit/b6528f6daf838d8d9c8ff0c6b8fc7e601f96904d))

## [Unreleased]

### Added
- Initial extension scaffolding: manifest, esbuild bundling, TypeScript strict mode, ESLint, Prettier.
- Output channel with a configurable `flexvault.logLevel` and the **FlexVault: Show Log** command.
- **FlexVault: Documentation**, **FlexVault: Open FlexVault Website**, and **FlexVault: Feedback & Support on Discord** commands.
- Unit tests under Vitest and extension host tests under `@vscode/test-cli`.
- CI workflow and release-please configuration.

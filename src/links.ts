/**
 * Canonical FlexVault URLs. Nothing else in the extension hard-codes one.
 * Bugs and feedback go to Discord.
 */
export const LINKS = {
  website: 'https://fxv.dev',
  docs: 'https://docs.fxv.dev',
  discord: 'https://discord.gg/KCMHRQBDf',
} as const;

export type LinkName = keyof typeof LINKS;

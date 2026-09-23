/**
 * The CLI binary version gate. Pure, and the range is injectable so fixture
 * tests can assert parse behavior without every fixture having to sit inside
 * the supported range.
 */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
  readonly build?: string;
}

export interface VersionRange {
  /** Inclusive. */
  readonly floor: SemVer;
  /** Exclusive. */
  readonly ceiling: SemVer;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemVer(text: string): SemVer | undefined {
  const match = SEMVER.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const [, major, minor, patch, prerelease, build] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    ...(prerelease === undefined ? {} : { prerelease }),
    ...(build === undefined ? {} : { build }),
  };
}

/**
 * Compares the release triple and ignores any prerelease or build suffix, so
 * `0.9.0-rc1` is treated as `0.9.0` and accepted, while `0.10.0-rc1` is treated
 * as `0.10.0` and blocked. A prerelease of a supported version is close enough
 * to run; a prerelease of the next breaking one is not.
 */
function compare(left: SemVer, right: SemVer): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * Only what has been tested. The ceiling is deliberate: 0.12.0 is the next
 * breaking CLI release and blocks the extension until someone re-pins and
 * tests, which belongs in the release checklist for every CLI minor.
 */
export const SUPPORTED_CLI_RANGE: VersionRange = {
  floor: { major: 0, minor: 11, patch: 0 },
  ceiling: { major: 0, minor: 12, patch: 0 },
};

export type ProgramProblem = 'unparsable' | 'below-floor' | 'above-ceiling';

/** What the user can be offered when the program version is out of range. */
export type Remedy = 'upgrade-cli' | 'upgrade-extension';

export type ProgramVerdict =
  | { readonly ok: true; readonly version: SemVer }
  | {
      readonly ok: false;
      readonly problem: ProgramProblem;
      readonly message: string;
      readonly remedy: Remedy;
      /** `fxv upgrade -y` can be offered. Release binaries are Windows only. */
      readonly upgradeCommandAvailable: boolean;
    };

export interface VersionGuardOptions {
  readonly range?: VersionRange;
  readonly platform?: NodeJS.Platform | string;
}

export class VersionGuard {
  private readonly range: VersionRange;
  private readonly platform: NodeJS.Platform | string;
  private programVerdict: ProgramVerdict | undefined;

  constructor(options: VersionGuardOptions = {}) {
    this.range = options.range ?? SUPPORTED_CLI_RANGE;
    this.platform = options.platform ?? process.platform;
  }

  /** The last program verdict, or undefined before the first command runs. */
  get lastProgramVerdict(): ProgramVerdict | undefined {
    return this.programVerdict;
  }

  /** True once a verdict blocks the CLI. Drives `flexvault.cliIncompatible`. */
  get blocked(): boolean {
    return this.programVerdict !== undefined && !this.programVerdict.ok;
  }

  /**
   * Drops the cached verdict. Call whenever the binary might have changed,
   * which is the `flexvault.cliPath` path and nothing else.
   */
  reset(): void {
    this.programVerdict = undefined;
  }

  checkProgram(version: string): ProgramVerdict {
    const verdict = this.evaluateProgram(version);
    this.programVerdict = verdict;
    return verdict;
  }

  private evaluateProgram(version: string): ProgramVerdict {
    const parsed = parseSemVer(version);
    if (!parsed) {
      return {
        ok: false,
        problem: 'unparsable',
        message: `The fxv CLI reported its version as "${version}", which is not a version this extension can compare against ${formatRange(this.range)}.`,
        remedy: 'upgrade-cli',
        upgradeCommandAvailable: this.upgradeCommandAvailable,
      };
    }
    if (compare(parsed, this.range.floor) < 0) {
      return {
        ok: false,
        problem: 'below-floor',
        message: `The fxv CLI is version ${version}, and this extension needs ${format(this.range.floor)} or later. Update the CLI.`,
        remedy: 'upgrade-cli',
        upgradeCommandAvailable: this.upgradeCommandAvailable,
      };
    }
    if (compare(parsed, this.range.ceiling) >= 0) {
      return {
        ok: false,
        problem: 'above-ceiling',
        message: `The fxv CLI is version ${version}, and this extension has only been tested against ${formatRange(this.range)}. Update the FlexVault extension, which is where support for a newer CLI arrives.`,
        remedy: 'upgrade-extension',
        upgradeCommandAvailable: false,
      };
    }
    return { ok: true, version: parsed };
  }

  /**
   * `fxv upgrade -y` only has a release binary to fetch on Windows x86_64
   * today, and a button that can only fail is worse than no button.
   */
  private get upgradeCommandAvailable(): boolean {
    return this.platform === 'win32';
  }
}

function format(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function formatRange(range: VersionRange): string {
  return `${format(range.floor)} up to but not including ${format(range.ceiling)}`;
}

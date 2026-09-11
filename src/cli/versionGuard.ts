import { finalKind } from './envelope';

/**
 * The two version gates: the binary's own version, and the payload contract of
 * each message kind being parsed. Pure, and the range is injectable so fixture
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
const MAJOR_MINOR = /^(\d+)\.(\d+)$/;

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

/** A message version is `major.minor` and nothing else. */
export function parseMessageVersion(text: string): { major: number; minor: number } | undefined {
  const match = MAJOR_MINOR.exec(text.trim());
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Ignores prerelease ordering. A prerelease of the floor sorts below it here,
 * which is the answer that keeps an untested build out.
 */
function compare(left: SemVer, right: SemVer): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * Only what has been tested. The ceiling is deliberate: 0.10.0 is the next
 * breaking CLI release and blocks the extension until someone re-pins and
 * tests, which belongs in the release checklist for every CLI minor.
 */
export const SUPPORTED_CLI_RANGE: VersionRange = {
  floor: { major: 0, minor: 9, patch: 0 },
  ceiling: { major: 0, minor: 10, patch: 0 },
};

/**
 * The payload contract each kind was generated from. A schema bump is a
 * one-line diff here, next to the regenerated types.
 */
export const MESSAGE_VERSIONS: Readonly<Record<string, string>> = {
  status: '1.0',
  history: '1.0',
  changeinfo: '1.0',
  goto: '1.0',
  sync: '1.0',
  revert: '1.0',
  resume: '1.0',
  doctor: '1.0',
  init: '1.0',
  login: '1.0',
  logout: '1.0',
  error: '1.1',
  // The error payload's nested sub-envelope is versioned on its own timeline.
  'interrupted-sync': '1.0',
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

export type MessageProblem = 'unparsable' | 'major-mismatch' | 'below-expected';

export type MessageVerdict =
  | { readonly ok: true; readonly checked: boolean }
  | {
      readonly ok: false;
      readonly problem: MessageProblem;
      readonly message: string;
      readonly remedy: Remedy;
    };

export interface VersionGuardOptions {
  readonly range?: VersionRange;
  readonly messageVersions?: Readonly<Record<string, string>>;
  readonly platform?: NodeJS.Platform | string;
}

export class VersionGuard {
  private readonly range: VersionRange;
  private readonly messageVersions: Readonly<Record<string, string>>;
  private readonly platform: NodeJS.Platform | string;
  private programVerdict: ProgramVerdict | undefined;

  constructor(options: VersionGuardOptions = {}) {
    this.range = options.range ?? SUPPORTED_CLI_RANGE;
    this.messageVersions = options.messageVersions ?? MESSAGE_VERSIONS;
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

  checkMessage(kind: string, version: string): MessageVerdict {
    const expectedText = this.messageVersions[finalKind(kind)];
    if (expectedText === undefined) {
      // A kind outside the table is a kind nothing here parses, so there is no
      // contract to break.
      return { ok: true, checked: false };
    }
    const expected = parseMessageVersion(expectedText);
    const actual = parseMessageVersion(version);
    if (!expected || !actual) {
      return {
        ok: false,
        problem: 'unparsable',
        message: `The fxv CLI reported a ${kind} payload version of "${version}", which is not a major.minor version.`,
        remedy: 'upgrade-extension',
      };
    }
    if (actual.major > expected.major) {
      return {
        ok: false,
        problem: 'major-mismatch',
        message: `The fxv CLI emits version ${version} of the ${kind} payload, and this extension reads version ${expectedText}. Update the FlexVault extension.`,
        remedy: 'upgrade-extension',
      };
    }
    if (actual.major < expected.major || actual.minor < expected.minor) {
      return {
        ok: false,
        problem: 'below-expected',
        message: `The fxv CLI emits version ${version} of the ${kind} payload, and this extension needs at least ${expectedText}. Update the fxv CLI.`,
        remedy: 'upgrade-cli',
      };
    }
    return { ok: true, checked: true };
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

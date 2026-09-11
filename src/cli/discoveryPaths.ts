import * as nodePath from 'path';

/**
 * Binary discovery, as a pure function of the platform, the environment, and a
 * predicate over the file system. Everything that needs the
 * editor host lives in `discovery.ts` next to this file.
 */

/** The order the candidates were produced in, for logging and for the UI. */
export type CliPathSource = 'setting' | 'standard' | 'path' | 'fallback';

export interface CliLocation {
  /** The path to spawn. Never empty. The fallback is the bare binary name. */
  readonly path: string;
  readonly source: CliPathSource;
  /**
   * `flexvault.cliPath` was set but was not an absolute path to an executable
   * file. The
   * setting is ignored in that case, and this flag is what lets the caller say
   * so rather than silently running some other binary.
   */
  readonly configuredPathMissing: boolean;
}

export interface DiscoveryEnvironment {
  readonly platform: NodeJS.Platform | string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `flexvault.cliPath`, trimmed. Empty or absent means unset. */
  readonly configuredPath?: string | undefined;
  /** True when the path refers to a file this process may execute. */
  readonly isExecutableFile: (candidate: string) => boolean;
}

const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';

export function isWindows(platform: NodeJS.Platform | string): boolean {
  return platform === 'win32';
}

export function binaryName(platform: NodeJS.Platform | string): string {
  return isWindows(platform) ? 'fxv.exe' : 'fxv';
}

function pathApi(platform: NodeJS.Platform | string): nodePath.PlatformPath {
  return isWindows(platform) ? nodePath.win32 : nodePath.posix;
}

/** Step 2: platform-standard install locations, in preference order. */
export function standardLocations(
  platform: NodeJS.Platform | string,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const join = pathApi(platform).join;
  if (isWindows(platform)) {
    const locations: string[] = [];
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
      locations.push(join(localAppData, 'fxv', 'bin', 'fxv.exe'));
    }
    const programFiles = env.ProgramFiles ?? env.PROGRAMFILES;
    if (programFiles) {
      locations.push(join(programFiles, 'FlexVault', 'bin', 'fxv.exe'));
    }
    return locations;
  }

  const locations: string[] = [];
  if (env.HOME) {
    // What `install.sh` targets, so it comes first.
    locations.push(join(env.HOME, '.local', 'bin', 'fxv'));
  }
  locations.push('/usr/local/bin/fxv', '/opt/homebrew/bin/fxv');
  if (env.HOME) {
    locations.push(join(env.HOME, '.cargo', 'bin', 'fxv'));
  }
  return locations;
}

/**
 * Step 3: every `PATH` entry crossed with the executable extensions that apply.
 * Windows resolves a bare command through `PATHEXT`, so a `fxv.cmd` shim on
 * `PATH` counts as a hit the same way `fxv.exe` does.
 */
export function pathScanLocations(
  platform: NodeJS.Platform | string,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const { join, delimiter } = pathApi(platform);
  const rawPath = env.PATH ?? env.Path ?? env.path ?? '';
  const entries = rawPath
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry.length > 0);

  const names = isWindows(platform) ? windowsExecutableNames(env) : ['fxv'];
  const locations: string[] = [];
  for (const entry of entries) {
    for (const name of names) {
      locations.push(join(entry, name));
    }
  }
  return locations;
}

function windowsExecutableNames(env: Readonly<Record<string, string | undefined>>): string[] {
  const extensions = (env.PATHEXT ?? DEFAULT_WINDOWS_PATHEXT)
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => extension.startsWith('.'));
  const names = extensions.map((extension) => `fxv${extension.toLowerCase()}`);
  return names.length > 0 ? names : ['fxv.exe'];
}

/**
 * The four discovery steps in order. The last one is unconditional: if
 * nothing was found we hand the OS the bare command and let it try, so a
 * missing binary surfaces as a spawn failure with a usable error rather than as
 * an extension that quietly does nothing.
 */
export function resolveCliPath(environment: DiscoveryEnvironment): CliLocation {
  const { platform, env, isExecutableFile } = environment;
  const configuredPath = environment.configuredPath?.trim() ?? '';
  // A relative setting would be resolved against the extension host's working
  // directory, which has nothing to do with the workspace, so it is rejected
  // rather than silently pointed at whatever sits there.
  const configuredPathUsable =
    configuredPath.length > 0 && pathApi(platform).isAbsolute(configuredPath);

  if (configuredPathUsable && isExecutableFile(configuredPath)) {
    return { path: configuredPath, source: 'setting', configuredPathMissing: false };
  }
  const configuredPathMissing = configuredPath.length > 0;

  for (const candidate of standardLocations(platform, env)) {
    if (isExecutableFile(candidate)) {
      return { path: candidate, source: 'standard', configuredPathMissing };
    }
  }

  for (const candidate of pathScanLocations(platform, env)) {
    if (isExecutableFile(candidate)) {
      return { path: candidate, source: 'path', configuredPathMissing };
    }
  }

  return { path: binaryName(platform), source: 'fallback', configuredPathMissing };
}

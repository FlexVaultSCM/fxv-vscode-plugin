/**
 * Filter that determines if a workspace-relative file path should be ignored by the file watcher.
 * Unconditionally ignores `.fxv_workspace` and `.git` internal paths, and respects `.fxvignore`
 * rules and configurable watcher exclusions.
 */
export class IgnoreFilter {
  private patterns: RegExp[] = [];

  constructor(fxvignoreContent?: string, extraExcludes: readonly string[] = []) {
    this.updateRules(fxvignoreContent, extraExcludes);
  }

  updateRules(fxvignoreContent?: string, extraExcludes: readonly string[] = []): void {
    const rules: RegExp[] = [];

    if (fxvignoreContent) {
      for (const line of fxvignoreContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }
        rules.push(patternToRegExp(trimmed));
      }
    }

    for (const exclude of extraExcludes) {
      const trimmed = exclude.trim();
      if (trimmed) {
        rules.push(patternToRegExp(trimmed));
      }
    }

    this.patterns = rules;
  }

  /**
   * Tests whether a path (relative to the workspace root) should be ignored.
   */
  isIgnored(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

    // Unconditional exclusions: .fxv_workspace and .git
    if (
      normalized === '.fxv_workspace' ||
      normalized.startsWith('.fxv_workspace/') ||
      normalized === '.git' ||
      normalized.startsWith('.git/')
    ) {
      return true;
    }

    for (const regex of this.patterns) {
      if (regex.test(normalized)) {
        return true;
      }
    }

    return false;
  }
}

export function patternToRegExp(pattern: string): RegExp {
  let p = pattern.trim().replace(/\\/g, '/');

  if (!p || p.startsWith('#')) {
    return /(?!)/;
  }

  // Determine prefix: rooted (at workspace root), wildcard path, or anywhere
  let prefix = '^(?:^|.*?/)';
  let isDoubleStarPrefix = false;
  if (p.startsWith('/')) {
    prefix = '^';
    p = p.slice(1);
  } else if (p.startsWith('**/')) {
    isDoubleStarPrefix = true;
    p = p.slice(3);
  }

  // Determine suffix: recursive directory match or exact match
  let suffix = '$';
  if (p.endsWith('/**')) {
    suffix = '(?:/.*|$)';
    p = p.slice(0, -3);
  } else if (p.endsWith('/')) {
    suffix = '(?:/.*|$)';
    p = p.slice(0, -1);
  } else if (!p.includes('/') && !p.includes('*') && !p.includes('?')) {
    // A single component name like '.venv', 'build', or 'dist' can match a directory or file
    suffix = '(?:/.*|$)';
  }

  // If the pattern contains an internal slash and was not explicitly prefixed with **/, it is rooted
  if (!isDoubleStarPrefix && prefix !== '^' && p.includes('/')) {
    prefix = '^';
  }

  // Escape special regex characters in the remaining pattern segments
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '(?:/|/.*?/)')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');

  return new RegExp(`${prefix}${escaped}${suffix}`);
}

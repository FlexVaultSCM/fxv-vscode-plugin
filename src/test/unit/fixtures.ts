import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Envelopes captured from a real `fxv`, stored under `src/test/fixtures/`.
 */

// Repo-root relative: vitest runs from its config directory, and `import.meta`
// is unavailable under the CommonJS target the extension compiles to.
const fixturesDir = process.env.FXV_FIXTURES_DIR
  ? resolve(process.env.FXV_FIXTURES_DIR)
  : resolve(process.cwd(), 'src', 'test', 'fixtures');

/** Raw text, which is what the runner is handed in production. */
export function fixtureText(name: string): string {
  const path = join(fixturesDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read the fixture ${name} from ${fixturesDir}.`, { cause });
  }
}

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Envelopes captured from a real `fxv`, read from `fxv-api-rs/tests/fixtures/`
 * rather than copied in: a copy is a second thing to keep current. CI checks the
 * sibling repository out, the same assumption `scripts/generate-types.mjs` makes.
 */

// Repo-root relative: vitest runs from its config directory, and `import.meta`
// is unavailable under the CommonJS target the extension compiles to.
const fixturesDir = process.env.FXV_FIXTURES_DIR
  ? resolve(process.env.FXV_FIXTURES_DIR)
  : resolve(process.cwd(), '..', 'fxv-api-rs', 'tests', 'fixtures');

/** Raw text, which is what the runner is handed in production. */
export function fixtureText(name: string): string {
  const path = join(fixturesDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `Could not read the fixture ${name} from ${fixturesDir}. Check out fxv-api-rs next to this repository, or point FXV_FIXTURES_DIR at its tests/fixtures directory.`,
      { cause },
    );
  }
}

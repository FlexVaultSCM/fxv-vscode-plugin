import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Reads the envelope fixtures captured from a real `fxv` binary, which live
 * upstream in `fxv-api-rs/tests/fixtures/` alongside the schemas the types are
 * generated from.
 *
 * They are not copied in here on purpose. A private copy is a second thing to
 * keep current, and the point of testing against these is that they are the
 * bytes the CLI actually wrote. CI checks the sibling repository out; locally
 * it is already next to this one, the same assumption `scripts/generate-types.mjs`
 * makes about the schemas.
 */

// Relative to the repository root rather than to this file: vitest runs from
// the directory holding its config, and `import.meta` is not available under
// the CommonJS target the rest of the extension compiles to.
const fixturesDir = process.env.FXV_FIXTURES_DIR
  ? resolve(process.env.FXV_FIXTURES_DIR)
  : resolve(process.cwd(), '..', 'fxv-api-rs', 'tests', 'fixtures');

/** The fixture's raw text, which is what the runner is handed in production. */
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

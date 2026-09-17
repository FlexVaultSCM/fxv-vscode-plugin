// Regenerates src/cli/types.generated.ts from the fxv-api-rs schemas.
//
// Run by hand after a schema change and commit the result. The schemas live in
// a sibling repository that CI does not check out, so the generated file is the
// build input and this script is not part of any npm lifecycle hook.
//
//   npm run types:generate
//   FXV_SCHEMAS_DIR=/path/to/fxv-api-rs/schemas npm run types:generate

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const schemasDir = process.env.FXV_SCHEMAS_DIR
  ? resolve(process.env.FXV_SCHEMAS_DIR)
  : resolve(repoRoot, '..', 'fxv-api-rs', 'schemas');
const outputFile = join(repoRoot, 'src', 'cli', 'types.generated.ts');

// The exported name each schema gets, keyed by file name. Only what v1 needs.
const SCHEMAS = {
  'envelope.schema.json': 'Envelope',
  'status.schema.json': 'StatusPayload',
  'history.schema.json': 'HistoryPayload',
  'changeinfo.schema.json': 'ChangeInfoPayload',
  'workspace_sync.schema.json': 'WorkspaceSyncPayload',
  'error.schema.json': 'ErrorPayload',
  'login.schema.json': 'LoginPayload',
  'logout.schema.json': 'LogoutPayload',
  'doctor.schema.json': 'DoctorPayload',
  // Never a top-level message: it rides in an error payload's `error_data`.
  'interrupted_sync.schema.json': 'InterruptedSyncPayload',
};

// Pulled in by $ref from the schemas above, and named here so the shared types
// come out as FileStatus rather than as a repeated anonymous shape.
const COMMON_DEFS = {
  fileStatus: 'FileStatus',
  commitRef: 'CommitRef',
  commitInfo: 'CommitInfo',
  changeKind: 'ChangeKind',
  conflictState: 'ConflictState',
  authorDetails: 'AuthorDetails',
};

// Not exported, but the envelope's payload `oneOf` references them, so the resolver has
// to be able to find them.
const SUPPORTING_SCHEMAS = [
  'common.schema.json',
  'init.schema.json',
  'upgrade.schema.json',
  'user.schema.json',
];

function loadSchema(file) {
  try {
    return JSON.parse(readFileSync(join(schemasDir, file), 'utf8'));
  } catch (cause) {
    throw new Error(
      `Could not read ${file} from ${schemasDir}. Check out fxv-api-rs next to this repository, or point FXV_SCHEMAS_DIR at its schemas directory.`,
      { cause },
    );
  }
}

const byId = new Map();
const idByFile = new Map();
for (const file of [...Object.keys(SCHEMAS), ...SUPPORTING_SCHEMAS]) {
  const schema = loadSchema(file);
  const title = SCHEMAS[file];
  if (title) {
    // The generator takes its type name from the title, and the schema titles
    // read as prose ("fxv status command payload").
    schema.title = title;
  }
  if (file === 'common.schema.json') {
    for (const [key, name] of Object.entries(COMMON_DEFS)) {
      schema.$defs[key].title = name;
    }
  }
  byId.set(schema.$id, schema);
  idByFile.set(file, schema.$id);
}

// The schemas reference each other by URN, which no resolver handles out of the
// box because a URN names a document without saying where it lives.
const urnResolver = {
  order: 1,
  canRead: /^urn:fxv:schema:/,
  read(file) {
    const schema = byId.get(file.url);
    if (!schema) {
      throw new Error(`No schema file declares $id ${file.url}.`);
    }
    return JSON.stringify(schema);
  },
};

// One compile over a root that references everything, so a type shared by two
// payloads is emitted once instead of once per payload.
const root = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'FxvSchemas',
  type: 'object',
  additionalProperties: false,
  required: Object.values(SCHEMAS).map((name) => name.toLowerCase()),
  properties: Object.fromEntries(
    Object.entries(SCHEMAS).map(([file, name]) => [
      name.toLowerCase(),
      { $ref: idByFile.get(file) },
    ]),
  ),
};

const banner = `/* eslint-disable */
/**
 * Generated from the fxv-api-rs schemas by scripts/generate-types.mjs.
 * Do not edit by hand: run \`npm run types:generate\` and commit the result.
 */`;

const generated = await compile(root, 'FxvSchemas', {
  bannerComment: banner,
  additionalProperties: false,
  declareExternallyReferenced: true,
  enableConstEnums: false,
  style: { singleQuote: true, printWidth: 100 },
  $refOptions: { resolve: { urn: urnResolver } },
});

writeFileSync(outputFile, generated, 'utf8');
process.stdout.write(`Wrote ${outputFile} from ${schemasDir}\n`);

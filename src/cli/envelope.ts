import type { Envelope as EnvelopeSchema, ErrorPayload } from './types.generated';

/**
 * Envelope parsing and the exit-code taxonomy. Pure: no process, no editor
 * host. The runner feeds raw stdout and an exit code in, and everything above
 * it branches on what comes out.
 */

export type ProgramInfo = EnvelopeSchema['program'];

/**
 * The `message` half of an envelope. Hand-written rather than generated: the
 * schema declares `payload` as a `oneOf` across every command, so the generated
 * shape is an index signature. The payload type comes from the caller, which
 * knows which command it ran.
 */
export interface EnvelopeMessage<TPayload = unknown> {
  readonly kind: string;
  readonly version: string;
  readonly payload: TPayload;
  readonly sequence?: number;
  readonly update_frequency_seconds?: number;
}

export interface Envelope<TPayload = unknown> {
  readonly program: ProgramInfo;
  readonly message: EnvelopeMessage<TPayload>;
}

/**
 * The nested sub-envelope an error payload may carry, versioned on its own
 * timeline. `error.schema.json` does not declare it yet, so it is typed here
 * and guarded like any other payload version.
 */
export interface ErrorData {
  readonly kind: string;
  readonly version: string;
  readonly payload: unknown;
}

export interface CliErrorPayload extends ErrorPayload {
  readonly error_data?: ErrorData;
}

/** The payload of an `interrupted-sync` error_data, as emitted at 0.9.0. */
export interface InterruptedSyncData {
  readonly operation: string;
  readonly completed_entries: number;
  readonly remaining_entries: number;
  readonly failed_entries: number;
  readonly preserved_entries: number;
  readonly sampled_unfinished_paths?: string[];
}

/**
 * What an exit code means. Every caller branches on this, never on message
 * text.
 */
export type ExitClass = 'success' | 'general' | 'interrupted' | 'locked' | 'died';

export const EXIT_CODES = {
  success: 0,
  general: 1,
  interrupted: 98,
  locked: 99,
  died: 127,
} as const;

export function classifyExitCode(code: number | null): ExitClass {
  switch (code) {
    case EXIT_CODES.success:
      return 'success';
    case EXIT_CODES.interrupted:
      return 'interrupted';
    case EXIT_CODES.locked:
      return 'locked';
    case EXIT_CODES.died:
      return 'died';
    default:
      // A null code means a signal killed the process, which is the same
      // situation as 127: it died without reporting anything.
      return code === null ? 'died' : 'general';
  }
}

export type EnvelopeParse<TPayload = unknown> =
  | { readonly ok: true; readonly envelope: Envelope<TPayload> }
  | { readonly ok: false; readonly reason: ParseFailure; readonly raw: string };

/**
 * `empty` is its own reason because the commands with no JSON success path
 * print human text: the runner reads an unparsable buffer as success there, and
 * as a broken CLI everywhere else.
 */
export type ParseFailure = 'empty' | 'invalid-json' | 'not-an-envelope';

/**
 * Reads the envelope out of a stdout buffer.
 *
 * Whole-buffer `JSON.parse` is the expected path. When that fails the buffer is
 * scanned for complete top-level objects and the last one wins, so the final
 * message is taken out of a progress stream, and the envelope out of a buffer
 * some other writer got a line into.
 */
export function parseEnvelope<TPayload = unknown>(stdout: string): EnvelopeParse<TPayload> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', raw: stdout };
  }

  const candidates = [trimmed, ...lastFirst(topLevelObjects(trimmed))];
  let sawJson = false;
  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed === undefined) {
      continue;
    }
    sawJson = true;
    if (isEnvelope(parsed)) {
      return { ok: true, envelope: parsed as Envelope<TPayload> };
    }
  }

  return { ok: false, reason: sawJson ? 'not-an-envelope' : 'invalid-json', raw: stdout };
}

/**
 * Interim progress messages use the final kind with a `-progress` suffix.
 * Nothing emits them at 0.9.0; the path exists so a progress stream has a
 * defined meaning rather than an accidental one.
 */
export function isProgressKind(kind: string): boolean {
  return kind.endsWith('-progress');
}

export function finalKind(kind: string): string {
  return isProgressKind(kind) ? kind.slice(0, -'-progress'.length) : kind;
}

export function isErrorEnvelope(envelope: Envelope): envelope is Envelope<CliErrorPayload> {
  return finalKind(envelope.message.kind) === 'error';
}

/**
 * Validates the error payload leniently, checking the two fields every consumer
 * reads and leaving the rest alone. `error.schema.json` seals itself with
 * `additionalProperties: false` and does not declare `error_data`, so a strict
 * validator rejects errors the CLI legitimately emits.
 */
export function isErrorPayload(payload: unknown): payload is CliErrorPayload {
  if (!isRecord(payload)) {
    return false;
  }
  return typeof payload.message === 'string' && typeof payload.exit_code === 'number';
}

export function errorData(payload: CliErrorPayload): ErrorData | undefined {
  const data: unknown = payload.error_data;
  if (!isRecord(data)) {
    return undefined;
  }
  if (typeof data.kind !== 'string' || typeof data.version !== 'string') {
    return undefined;
  }
  return data as unknown as ErrorData;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function lastFirst<T>(items: T[]): T[] {
  return [...items].reverse();
}

/**
 * Splits a buffer into complete top-level JSON objects. String literals and
 * their escapes are tracked, so a brace inside a commit description does not
 * end an object early.
 */
export function topLevelObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (character === '}') {
      if (depth === 0) {
        // A closing brace with nothing open is junk between objects.
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value)) {
    return false;
  }
  const program: unknown = value.program;
  const message: unknown = value.message;
  if (!isRecord(program) || !isRecord(message)) {
    return false;
  }
  if (typeof program.name !== 'string' || typeof program.version !== 'string') {
    return false;
  }
  if (typeof message.kind !== 'string' || typeof message.version !== 'string') {
    return false;
  }
  return 'payload' in message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

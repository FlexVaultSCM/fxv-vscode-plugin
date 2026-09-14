import { describe, expect, it } from 'vitest';

import {
  classifyExitCode,
  errorData,
  interruptedSync,
  isErrorEnvelope,
  parseEnvelope,
} from '../../cli/envelope';
import { parseSpec, specFromCommitInfo } from '../../cli/revision';
import { MESSAGE_VERSIONS, VersionGuard } from '../../cli/versionGuard';
import type {
  ChangeInfoPayload,
  HistoryPayload,
  StatusPayload,
  WorkspaceSyncPayload,
} from '../../cli/types.generated';
import { fixtureText } from './fixtures';

/**
 * The envelope path against bytes a real `fxv` wrote. The rest of the suite
 * builds its own payloads, which never proves the CLI agrees.
 */

/** Parses a success fixture and asserts its kind, the way the runner does. */
function successFixture<TPayload>(name: string, kind: string): TPayload {
  const parsed = parseEnvelope<TPayload>(fixtureText(name));
  expect(parsed.ok, `${name} should parse as an envelope`).toBe(true);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  expect(parsed.envelope.message.kind).toBe(kind);
  expect(isErrorEnvelope(parsed.envelope)).toBe(false);

  // The check the runner makes on every call.
  const guard = new VersionGuard();
  expect(guard.checkMessage(kind, parsed.envelope.message.version)).toEqual({
    ok: true,
    checked: true,
  });

  return parsed.envelope.message.payload;
}

describe('captured envelopes', () => {
  it('reads a status payload, including the axes a file is changed on', () => {
    const status = successFixture<StatusPayload>('status.json', 'status');
    expect(status.current_branch).toBe('main');
    expect(status.head_commit.state).toBe('unparented_draft');
    expect(status.file_change_counts.total).toBe(status.files.length);
    expect(status.files.every((file) => file.conflict_state === undefined)).toBe(true);
  });

  it('reads the workspace-sync payload under each of its kinds', () => {
    const sync = successFixture<WorkspaceSyncPayload>('sync.json', 'sync');
    expect(sync.target_revision).toBe('main.-.4');
    expect(sync.files_updated).toHaveLength(0);

    const goto = successFixture<WorkspaceSyncPayload>('goto.json', 'goto');
    expect(goto.files_updated).toHaveLength(goto.files_updated_count);

    const revert = successFixture<WorkspaceSyncPayload>('revert.json', 'revert');
    expect(revert.target_revision).toBe('main.-.7');

    // All three snapshot before moving, so the kind is the only discriminator.
    // Pinned because the destructive-command copy promises that snapshot.
    for (const payload of [sync, goto, revert]) {
      expect(payload.created_revisions?.length).toBeGreaterThan(0);
    }
  });

  it('reads a history payload without keying on a commit hash', () => {
    const history = successFixture<HistoryPayload>('history.json', 'history');
    expect(history.entries.length).toBeGreaterThan(0);
    for (const entry of history.entries) {
      expect(entry.commit_hash, 'history omits commit_hash').toBeUndefined();
      expect(entry.author_display_name.length).toBeGreaterThan(0);
    }
  });

  it('reads a changeinfo payload whose summary matches its changes', () => {
    const info = successFixture<ChangeInfoPayload>('changeinfo.json', 'changeinfo');
    expect(info.summary.total_changed).toBe(info.changes.length);
  });
});

describe('revision specs from captured payloads', () => {
  it('writes an unparented draft as the `-` form', () => {
    const status = successFixture<StatusPayload>('status.json', 'status');
    if (status.head_commit.state !== 'unparented_draft') {
      throw new Error('the status fixture is captured on an unparented draft');
    }

    const spec = specFromCommitInfo(status.head_commit.local_snapshot.commit);
    expect(spec).toBe('main.-.1');
    expect(parseSpec(spec)).toEqual({ branch: 'main', draftRevision: 1 });
  });

  it('round-trips the spec a sync reports as its target', () => {
    const sync = successFixture<WorkspaceSyncPayload>('sync.json', 'sync');
    const parsed = parseSpec(sync.target_revision);
    expect(parsed).toBeDefined();
    expect(specFromCommitInfo({ branch: 'main', type: 'draft', draft_revision: 4 })).toBe(
      sync.target_revision,
    );
  });
});

describe('captured error envelopes', () => {
  it('classifies a general failure as an error envelope, not by its exit code alone', () => {
    const parsed = parseEnvelope(fixtureText('error.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(isErrorEnvelope(parsed.envelope)).toBe(true);
    if (!isErrorEnvelope(parsed.envelope)) {
      return;
    }

    const payload = parsed.envelope.message.payload;
    expect(payload.exit_code).toBe(1);
    expect(classifyExitCode(payload.exit_code)).toBe('general');
    expect(payload.message).toContain('No workspace found');
  });

  it('reads the interrupted-sync detail out of error_data rather than the message', () => {
    const parsed = parseEnvelope(fixtureText('interrupted_sync_error.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !isErrorEnvelope(parsed.envelope)) {
      throw new Error('the interrupted-sync fixture is an error envelope');
    }

    const payload = parsed.envelope.message.payload;
    expect(classifyExitCode(payload.exit_code)).toBe('interrupted');

    const data = errorData(payload);
    expect(data?.kind).toBe('interrupted-sync');
    if (!data) {
      return;
    }

    // Versioned on its own timeline, guarded like any other payload.
    const guard = new VersionGuard();
    expect(guard.checkMessage(data.kind, data.version)).toEqual({ ok: true, checked: true });

    const detail = interruptedSync(data);
    expect(detail).toBeDefined();
    if (!detail || !('operation' in detail)) {
      return;
    }
    expect(detail.operation).toBe('goto');
    // Enough for the recovery banner without parsing the message text.
    expect(detail.completed_entries + detail.remaining_entries).toBe(detail.total_entries);
    expect(detail.sampled_unfinished_paths).toHaveLength(detail.remaining_entries);
  });
});

describe('the version guard against captured program versions', () => {
  it('rejects the CLI the oldest fixtures were captured with', () => {
    const parsed = parseEnvelope(fixtureText('status.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }

    // Below any floor this extension pins: what the injectable range exists for.
    // A payload the guard turns away still has to parse.
    const verdict = new VersionGuard().checkProgram(parsed.envelope.program.version);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    expect(verdict.problem).toBe('below-floor');
    expect(verdict.remedy).toBe('upgrade-cli');
  });

  it('accepts the CLI the current fixtures were captured with', () => {
    const parsed = parseEnvelope(fixtureText('revert.json'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    expect(new VersionGuard().checkProgram(parsed.envelope.program.version)).toEqual({
      ok: true,
      version: { major: 0, minor: 9, patch: 0 },
    });
  });

  it('has a version-table entry for every kind the fixtures carry', () => {
    const fixtures = [
      'status.json',
      'history.json',
      'changeinfo.json',
      'sync.json',
      'goto.json',
      'revert.json',
      'logout.json',
      'init.json',
    ];

    for (const name of fixtures) {
      const parsed = parseEnvelope(fixtureText(name));
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      expect(MESSAGE_VERSIONS, name).toHaveProperty(parsed.envelope.message.kind);
    }
  });
});

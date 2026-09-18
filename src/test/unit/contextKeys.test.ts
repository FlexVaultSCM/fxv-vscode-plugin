import { describe, expect, it } from 'vitest';

import type { StatusPayload } from '../../cli/types.generated';
import { ContextKeys, type SetContextFn } from '../../state/contextKeys';

describe('ContextKeys', () => {
  function createRecorder(): {
    keys: Record<string, unknown>;
    setContext: SetContextFn;
  } {
    const keys: Record<string, unknown> = {};
    const setContext: SetContextFn = (key, value) => {
      keys[key] = value;
      return Promise.resolve();
    };
    return { keys, setContext };
  }

  it('sets enabled, busy, interrupted, and cliIncompatible', async () => {
    const { keys, setContext } = createRecorder();
    const contextKeys = new ContextKeys(setContext);

    await contextKeys.setEnabled(true);
    expect(keys['flexvault.enabled']).toBe(true);

    await contextKeys.setBusy(true);
    expect(keys['flexvault.busy']).toBe(true);

    await contextKeys.setInterrupted(true);
    expect(keys['flexvault.interrupted']).toBe(true);

    await contextKeys.setCliIncompatible(true);
    expect(keys['flexvault.cliIncompatible']).toBe(true);

    await contextKeys.setCliNotFound(true);
    expect(keys['flexvault.cliNotFound']).toBe(true);
  });

  it('derives context keys from status with logged-in user and conflicts', async () => {
    const { keys, setContext } = createRecorder();
    const contextKeys = new ContextKeys(setContext);

    const status: StatusPayload = {
      current_branch: 'main',
      current_user: 'alice',
      head_commit: {
        state: 'parented_draft',
        local_snapshot: {
          commit: { branch: 'main', type: 'draft', revision: 1 },
          timestamp_millis_since_epoch_utc: 1000,
          author_id: 'user:1',
          author_display_name: 'Alice',
          author_details: { type: 'Local' },
        },
        published_head: {
          commit: { branch: 'main', type: 'published', revision: 1 },
          timestamp_millis_since_epoch_utc: 900,
          author_id: 'user:1',
          author_display_name: 'Alice',
          author_details: { type: 'Local' },
        },
      },
      files: [
        {
          path: 'alpha.txt',
          unpublished_state: 'modified',
          conflict_state: { kind: 'content' },
        },
      ],
      file_change_counts: {
        total: 1,
        unpublished: 1,
        workspace_need_snapshot: 0,
      },
    };

    await contextKeys.setInterrupted(true);
    expect(keys['flexvault.interrupted']).toBe(true);

    await contextKeys.updateFromStatus(status);

    expect(keys['flexvault.loggedIn']).toBe(true);
    expect(keys['flexvault.hasConflicts']).toBe(true);
    expect(keys['flexvault.headState']).toBe('parented_draft');
    expect(keys['flexvault.interrupted']).toBe(false);
  });

  it('derives context keys when logged out and conflict-free', async () => {
    const { keys, setContext } = createRecorder();
    const contextKeys = new ContextKeys(setContext);

    const status: StatusPayload = {
      current_branch: 'main',
      head_commit: {
        state: 'empty_branch',
        branch: 'main',
      },
      files: [
        {
          path: 'beta.txt',
          workspace_state: 'added',
        },
      ],
      file_change_counts: {
        total: 1,
        unpublished: 0,
        workspace_need_snapshot: 1,
      },
    };

    await contextKeys.updateFromStatus(status);

    expect(keys['flexvault.loggedIn']).toBe(false);
    expect(keys['flexvault.hasConflicts']).toBe(false);
    expect(keys['flexvault.headState']).toBe('empty_branch');
  });

  it('resets context keys on undefined status', async () => {
    const { keys, setContext } = createRecorder();
    const contextKeys = new ContextKeys(setContext);

    await contextKeys.updateFromStatus(undefined);

    expect(keys['flexvault.loggedIn']).toBe(false);
    expect(keys['flexvault.hasConflicts']).toBe(false);
    expect(keys['flexvault.headState']).toBeUndefined();
  });
});

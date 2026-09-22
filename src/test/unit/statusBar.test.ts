import { describe, expect, it } from 'vitest';

import type { StatusPayload } from '../../cli/types.generated';
import { StatusBar } from '../../ui/statusBar';

function fakeItem() {
  return {
    text: '',
    tooltip: '',
    command: undefined as string | undefined,
    shown: false,
    disposed: false,
    show(this: { shown: boolean }) {
      this.shown = true;
    },
    hide(this: { shown: boolean }) {
      this.shown = false;
    },
    dispose(this: { disposed: boolean }) {
      this.disposed = true;
    },
  };
}

function status(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    current_branch: 'main',
    current_user: 'alice',
    head_commit: { state: 'parented_draft' } as StatusPayload['head_commit'],
    files: [],
    file_change_counts: { total: 0, unpublished: 0, workspace_need_snapshot: 0 },
    ...overrides,
  };
}

function loggedOutStatus(): StatusPayload {
  const withUser = status();
  const rest: Partial<StatusPayload> = { ...withUser };
  delete rest.current_user;
  return rest as StatusPayload;
}

describe('StatusBar', () => {
  it('hides the item when status is undefined', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.update(undefined);

    expect(item.shown).toBe(false);
  });

  it('shows the branch and a sync command while logged in and up to date', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.update(status());

    expect(item.text).toContain('main');
    expect(item.text).not.toContain('↓');
    expect(item.command).toBe('flexvault.sync');
    expect(item.shown).toBe(true);
  });

  it('shows revisions behind when sync_status is not up to date', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.update(
      status({
        sync_status: {
          up_to_date: false,
          revisions_behind: 3,
          published_head_revision: 12,
          synced_revision: 9,
        },
      }),
    );

    expect(item.text).toContain('3↓');
    expect(item.tooltip).toContain('3 revisions behind');
  });

  it('offers login instead of sync when logged out', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.update(loggedOutStatus());

    expect(item.command).toBe('flexvault.login');
    expect(item.text).toContain('$(sign-in)');
  });

  it('shows error state when showError is called', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.showError('Repository format mismatch');

    expect(item.shown).toBe(true);
    expect(item.text).toBe('$(error) FlexVault');
    expect(item.tooltip).toContain('Repository format mismatch');
    expect(item.command).toBe('flexvault.showLog');
  });

  it('disposes the underlying item', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.dispose();

    expect(item.disposed).toBe(true);
  });
});

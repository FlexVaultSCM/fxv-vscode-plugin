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
  it('hides items when status is undefined', () => {
    const branchItem = fakeItem();
    const syncItem = fakeItem();
    const bar = new StatusBar(
      () => branchItem as never,
      () => syncItem as never,
    );

    bar.update(undefined);

    expect(branchItem.shown).toBe(false);
    expect(syncItem.shown).toBe(false);
  });

  it('shows repository name alongside branch and opens branch switch on click', () => {
    const branchItem = fakeItem();
    const syncItem = fakeItem();
    const bar = new StatusBar(
      () => branchItem as never,
      () => syncItem as never,
    );

    bar.update(status(), 'my-repo');

    expect(branchItem.text).toBe('$(repo) my-repo $(git-branch) main');
    expect(branchItem.command).toBe('flexvault.branchSwitch');
    expect(branchItem.tooltip).toContain('my-repo on branch main');
    expect(branchItem.tooltip).toContain('Click to switch branch');
    expect(branchItem.shown).toBe(true);

    expect(syncItem.text).toBe('$(sync)');
    expect(syncItem.command).toBe('flexvault.sync');
    expect(syncItem.shown).toBe(true);
  });

  it('shows branch name without repo prefix when repoName is omitted', () => {
    const branchItem = fakeItem();
    const bar = new StatusBar(() => branchItem as never);

    bar.update(status());

    expect(branchItem.text).toBe('$(git-branch) main');
    expect(branchItem.command).toBe('flexvault.branchSwitch');
    expect(branchItem.tooltip).toContain('on branch main');
    expect(branchItem.shown).toBe(true);
  });

  it('shows revisions behind on the sync item when sync_status is not up to date', () => {
    const branchItem = fakeItem();
    const syncItem = fakeItem();
    const bar = new StatusBar(
      () => branchItem as never,
      () => syncItem as never,
    );

    bar.update(
      status({
        sync_status: {
          up_to_date: false,
          revisions_behind: 3,
          published_head_revision: 12,
          synced_revision: 9,
        },
      }),
      'test-workspace',
    );

    expect(branchItem.text).toBe('$(repo) test-workspace $(git-branch) main');
    expect(branchItem.command).toBe('flexvault.branchSwitch');
    expect(syncItem.text).toBe('$(sync) 3↓');
    expect(syncItem.tooltip).toContain('3 revisions behind');
    expect(syncItem.command).toBe('flexvault.sync');
  });

  it('offers login on the sync item when logged out', () => {
    const branchItem = fakeItem();
    const syncItem = fakeItem();
    const bar = new StatusBar(
      () => branchItem as never,
      () => syncItem as never,
    );

    bar.update(loggedOutStatus(), 'test-repo');

    expect(branchItem.command).toBe('flexvault.branchSwitch');
    expect(syncItem.command).toBe('flexvault.login');
    expect(syncItem.text).toBe('$(sign-in)');
    expect(syncItem.tooltip).toContain('Logged out');
  });

  it('shows error state on branch item and hides sync item when showError is called', () => {
    const branchItem = fakeItem();
    const syncItem = fakeItem();
    const bar = new StatusBar(
      () => branchItem as never,
      () => syncItem as never,
    );

    bar.showError('Repository format mismatch');

    expect(branchItem.shown).toBe(true);
    expect(branchItem.text).toBe('$(error) FlexVault');
    expect(branchItem.tooltip).toContain('Repository format mismatch');
    expect(branchItem.command).toBe('flexvault.showLog');
    expect(syncItem.shown).toBe(false);
  });

  it('disposes underlying items', () => {
    const branchItem = fakeItem();
    const syncItem = fakeItem();
    const bar = new StatusBar(
      () => branchItem as never,
      () => syncItem as never,
    );

    bar.dispose();

    expect(branchItem.disposed).toBe(true);
    expect(syncItem.disposed).toBe(true);
  });
});

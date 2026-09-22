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

describe('StatusBar', () => {
  it('hides the item when status is undefined', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.update(undefined);

    expect(item.shown).toBe(false);
  });

  it('hides the item when status is present (delegated to SCM statusBarCommands)', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.update(status());

    expect(item.shown).toBe(false);
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

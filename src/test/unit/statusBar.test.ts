import { describe, expect, it } from 'vitest';

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

describe('StatusBar', () => {
  it('hides the item when clearError is called', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.clearError();

    expect(item.shown).toBe(false);
  });

  it('hides the item after an error was previously shown', () => {
    const item = fakeItem();
    const bar = new StatusBar(() => item as never);

    bar.showError('Repository format mismatch');
    bar.clearError();

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

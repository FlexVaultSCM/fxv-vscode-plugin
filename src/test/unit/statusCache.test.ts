import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import type { FxvCommands } from '../../cli/commands';
import { StatusCache } from '../../state/statusCache';

describe('StatusCache', () => {
  it('calls onStatusError when status fails with an unexpected exit code', async () => {
    const rootUri = vscode.Uri.file('/test/workspace');
    let errorReported: { msg: string; exitCode?: number | null | undefined } | undefined;

    const fxv = {
      status: vi.fn().mockResolvedValue({
        ok: false,
        exitCode: 1,
        message:
          'This draft repository uses format version 0, which this version of fxv can no longer read',
      }),
    } as unknown as FxvCommands;

    const statusCache = new StatusCache(fxv, rootUri, {
      getDebounceMs: () => 300,
      isWatchEnabled: () => false,
      getWatchExclude: () => [],
      onStatusError: (msg, exitCode) => {
        errorReported = { msg, exitCode };
      },
    });

    const result = await statusCache.refresh();

    expect(result).toBeUndefined();
    expect(errorReported).toBeDefined();
    expect(errorReported?.exitCode).toBe(1);
    expect(errorReported?.msg).toContain('format version 0');

    statusCache.dispose();
  });
});

import { vi } from 'vitest';

export class MockUri {
  constructor(
    readonly fsPath: string,
    readonly path: string,
    readonly scheme: string,
    readonly query: string = '',
  ) {}

  toString(): string {
    const q = this.query ? `?${this.query}` : '';
    return `${this.scheme}:${this.path}${q}`;
  }
}

export class EventEmitter<T = unknown> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(),
  };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {}
}

export const Uri = {
  file: (filePath: string): MockUri => {
    const p = filePath.replace(/\\/g, '/');
    return new MockUri(p, p, 'file');
  },
  parse: (str: string): MockUri => new MockUri(str, str, 'https'),
  joinPath: (base: MockUri, ...segments: string[]): MockUri => {
    const joined = [base.fsPath, ...segments].join('/').replace(/\/+/g, '/');
    return new MockUri(joined, joined, base.scheme);
  },
  from: (components: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): MockUri => {
    const p = components.path ?? '';
    return new MockUri(p, p, components.scheme, components.query ?? '');
  },
};

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
};

export const window = {
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),
  withProgress: vi
    .fn()
    .mockImplementation(
      <T>(
        _options: unknown,
        task: (progress: unknown, token: unknown) => Promise<T>,
      ): Promise<T> => {
        const progress = { report: vi.fn() };
        const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
        return task(progress, token);
      },
    ),
};

export const commands = {
  executeCommand: vi.fn().mockResolvedValue(undefined),
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export const workspace = {
  textDocuments: [] as unknown[],
  saveAll: vi.fn().mockResolvedValue(true),
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn(),
  }),
};

export const debug = {
  activeDebugSession: undefined as unknown,
};

export const scm = {
  createSourceControl: vi.fn().mockImplementation((id: string, label: string, rootUri: unknown) => {
    const resourceGroups: Array<{
      id: string;
      label: string;
      hideWhenEmpty?: boolean;
      resourceStates: unknown[];
      dispose: () => void;
    }> = [];

    return {
      id,
      label,
      rootUri,
      inputBox: { placeholder: '', enabled: true, value: '' },
      acceptInputCommand: undefined,
      count: 0,
      createResourceGroup: vi.fn().mockImplementation((groupId: string, groupLabel: string) => {
        const group = {
          id: groupId,
          label: groupLabel,
          hideWhenEmpty: false,
          resourceStates: [],
          dispose: vi.fn(),
        };
        resourceGroups.push(group);
        return group;
      }),
      resourceGroups,
      dispose: vi.fn(),
    };
  }),
};

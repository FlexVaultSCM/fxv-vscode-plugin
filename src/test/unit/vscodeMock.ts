import { vi } from 'vitest';

export interface MockUri {
  readonly fsPath: string;
  readonly path: string;
  readonly scheme: string;
}

export const Uri = {
  file: (filePath: string): MockUri => ({
    fsPath: filePath.replace(/\\/g, '/'),
    path: filePath.replace(/\\/g, '/'),
    scheme: 'file',
  }),
  parse: (str: string): MockUri => ({
    fsPath: str,
    path: str,
    scheme: 'https',
  }),
  joinPath: (base: MockUri, ...segments: string[]): MockUri => {
    const joined = [base.fsPath, ...segments].join('/').replace(/\/+/g, '/');
    return {
      fsPath: joined,
      path: joined,
      scheme: base.scheme,
    };
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

// VS Code API mocks
export const window = {
  createOutputChannel: jest.fn().mockReturnValue({
    appendLine: jest.fn(),
    dispose: jest.fn()
  }),
  showErrorMessage: jest.fn().mockImplementation((message: string) => {
    void message; // ESLint: mark as intentionally unused
    return Promise.resolve(undefined);
  }),
  showInformationMessage: jest.fn(),
  showQuickPick: jest.fn(),
  withProgress: jest.fn(),
};

export const workspace = {
  getConfiguration: jest.fn(),
  getWorkspaceFolder: jest.fn(),
  workspaceFolders: [],
  onDidChangeTextDocument: jest.fn(),
  onDidSaveTextDocument: jest.fn()
};

export const commands = {
  executeCommand: jest.fn(),
  registerCommand: jest.fn(),
};

// 使用命名空间而不是常量对象来满足ESLint命名约定
export namespace TreeItemCollapsibleState {
  export const NONE = 0;
  export const COLLAPSED = 1;
  export const EXPANDED = 2;
}

export class TreeItem {
  constructor(public label: string, public collapsibleState: number) {}
}

export class ThemeIcon {
  constructor(public name: string) {}
}

export namespace ProgressLocation {
  export const NOTIFICATION = 15;
}

export namespace Uri {
  export function file(filePath: string): { fsPath: string } {
    return { fsPath: filePath };
  }
}
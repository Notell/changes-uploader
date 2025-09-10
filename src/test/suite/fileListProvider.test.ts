import * as vscode from 'vscode';
// import * as path from 'path'; // 已注释未使用的导入
import * as fs from 'fs';
import { FileListProvider, FileItem } from '../../fileListProvider';
import { FileTracker, ITrackedFile } from '../../fileTracker';

// Mock VS Code API
jest.mock('vscode', () => ({
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showQuickPick: jest.fn(),
    withProgress: jest.fn(),
    createOutputChannel: jest.fn().mockReturnValue({
      appendLine: jest.fn(),
      dispose: jest.fn()
    })
  },
  workspace: {
    getConfiguration: jest.fn(),
    getWorkspaceFolder: jest.fn(),
    onDidSaveTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() })
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  },
  ThemeIcon: jest.fn().mockImplementation((name) => ({ name })),
  ProgressLocation: {
    Notification: 15
  },
  commands: {
    executeCommand: jest.fn()
  },
  Uri: {
    file: (filePath: string): { fsPath: string } => ({ fsPath: filePath })
  },
  TreeItem: class TreeItem {
    label: string;
    collapsibleState: number;
    tooltip?: string;
    contextValue?: string;
    iconPath?: string | { name: string };
    command?: { title: string; command: string; arguments?: unknown[] };
    
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  EventEmitter: class EventEmitter<T> {
    event: (listener: (e: T) => void) => { dispose(): void };
    constructor() {
      this.event = jest.fn().mockReturnValue({ dispose: jest.fn() });
    }
    fire(): void {
      // 模拟触发事件
      const listeners = (this.event as jest.Mock).mock?.calls?.[0]?.[0] || [];
      if (typeof listeners === 'function') {
        listeners();
      }
    }
    dispose(): void {}
  },
  Event: jest.fn()
}));

// Mock file system
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock SSH2 SFTP Client
jest.mock('ssh2-sftp-client', () => {
  const mockClient = jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    end: jest.fn(),
    put: jest.fn(),
    mkdir: jest.fn()
  }));
  
  return {
    __esModule: true,
    default: mockClient,
    Client: mockClient
  };
});
const mockShowErrorMessage = vscode.window.showErrorMessage as jest.MockedFunction<typeof vscode.window.showErrorMessage>;
const mockShowInformationMessage = vscode.window.showInformationMessage as jest.MockedFunction<typeof vscode.window.showInformationMessage>;
const mockWithProgress = vscode.window.withProgress as jest.MockedFunction<typeof vscode.window.withProgress>;
const mockGetConfiguration = vscode.workspace.getConfiguration as jest.MockedFunction<typeof vscode.workspace.getConfiguration>;
const mockGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder as jest.MockedFunction<typeof vscode.workspace.getWorkspaceFolder>;
const mockShowQuickPick = vscode.window.showQuickPick as jest.MockedFunction<typeof vscode.window.showQuickPick>;

const mockOutputChannel = vscode.window.createOutputChannel('Changes Uploader Test');

// 模拟TrackedFile数据
const mockTrackedFiles: ITrackedFile[] = [
  {
    filePath: '/path/to/repo/src/file1.ts',
    fileName: 'file1.ts',
    status: 'staged',
    lastModified: Date.now()
  },
  {
    filePath: '/path/to/repo/src/file2.ts',
    fileName: 'file2.ts',
    status: 'unstaged',
    lastModified: Date.now()
  }
];

describe('FileItem', () => {
  it('应该正确创建文件项', (): void => {
    const trackedFile = mockTrackedFiles[0];
    const fileItem = new FileItem(trackedFile, vscode.TreeItemCollapsibleState.None);

    expect(fileItem.label).toBe(trackedFile.fileName);
    expect(fileItem.tooltip).toBe(trackedFile.filePath);
    expect(fileItem.contextValue).toBe('fileItem');
    expect(fileItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('应该根据文件状态设置不同的图标', (): void => {
    // 测试staged状态
    const stagedFile = { ...mockTrackedFiles[0], status: 'staged' };
    const stagedItem = new FileItem(stagedFile, vscode.TreeItemCollapsibleState.None);
    expect(stagedItem.iconPath).toBeDefined();

    // 测试unstaged状态
    const unstagedFile = { ...mockTrackedFiles[0], status: 'unstaged' };
    const unstagedItem = new FileItem(unstagedFile, vscode.TreeItemCollapsibleState.None);
    expect(unstagedItem.iconPath).toBeDefined();

    // 测试untracked状态
    const untrackedFile = { ...mockTrackedFiles[0], status: 'untracked' };
    const untrackedItem = new FileItem(untrackedFile, vscode.TreeItemCollapsibleState.None);
    expect(untrackedItem.iconPath).toBeDefined();
  });

  it('应该设置正确的命令用于打开文件', (): void => {
    const trackedFile = mockTrackedFiles[0];
    const fileItem = new FileItem(trackedFile, vscode.TreeItemCollapsibleState.None);

    expect(fileItem.command).toBeDefined();
    expect(fileItem.command?.command).toBe('vscode.open');
    expect(fileItem.command?.arguments).toBeDefined();
  });
});

describe('FileListProvider', () => {
  let fileListProvider: FileListProvider;
  let mockFileTracker: jest.Mocked<FileTracker>;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    // 重置所有mock
    jest.clearAllMocks();

    // 创建模拟的扩展上下文
    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn().mockReturnValue([])
      },
      globalState: {
        get: jest.fn().mockReturnValue([]),
        update: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
        setKeysForSync: jest.fn()
      },
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
        onDidChange: jest.fn()
      },
      extensionUri: {
        scheme: 'file',
        authority: '',
        path: '',
        query: '',
        fragment: '',
        fsPath: '',
        with: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({})
      },
      extensionPath: '',
      environmentVariableCollection: {
        getScoped: jest.fn(),
        persistent: false,
        description: '',
        replace: jest.fn(),
        append: jest.fn(),
        prepend: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
        forEach: jest.fn(),
        [Symbol.iterator]: jest.fn()
      },
      storageUri: {
        scheme: 'file',
        authority: '',
        path: '',
        query: '',
        fragment: '',
        fsPath: '',
        with: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({})
      },
      storagePath: '',
      globalStorageUri: {
        scheme: 'file',
        authority: '',
        path: '',
        query: '',
        fragment: '',
        fsPath: '',
        with: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({})
      },
      globalStoragePath: '',
      logUri: {
        scheme: 'file',
        authority: '',
        path: '',
        query: '',
        fragment: '',
        fsPath: '',
        with: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({})
      },
      logPath: '',
      extensionMode: 1,
      asAbsolutePath: jest.fn(),
      extension: {
        id: 'test-extension',
        extensionUri: {
          scheme: 'file',
          authority: '',
          path: '',
          query: '',
          fragment: '',
          fsPath: '',
          with: jest.fn().mockReturnThis(),
          toJSON: jest.fn().mockReturnValue({})
        },
        extensionPath: '',
        isActive: true,
        packageJSON: {},
        extensionKind: 1,
        exports: undefined,
        activate: jest.fn()
      },
      languageModelAccessInformation: {
        onDidChange: jest.fn(),
        canSendRequest: jest.fn()
      }
    };

    // 创建模拟的文件跟踪器
    mockFileTracker = {
      getTrackedFiles: jest.fn().mockReturnValue(mockTrackedFiles),
      removeFile: jest.fn().mockImplementation(() => {
        // 模拟成功移除文件
        return true;
      }),
      addStatusListener: jest.fn().mockImplementation(() => {}),
      removeStatusListener: jest.fn().mockImplementation(() => {}),
      isFileTracked: jest.fn().mockReturnValue(true),
      updateFileStatus: jest.fn().mockResolvedValue(undefined),
      loadTrackedFiles: jest.fn(),
      setupGitCommitListener: jest.fn(),
      handleGitCommit: jest.fn(),
      addTrackedFile: jest.fn(),
      clearAllTrackedFiles: jest.fn()
    } as unknown as jest.Mocked<FileTracker>;

    // 创建FileListProvider实例
    fileListProvider = new FileListProvider(mockFileTracker, mockContext, mockOutputChannel);

    // 设置withProgress mock
    mockWithProgress.mockImplementation((options, task) => {
      return Promise.resolve(task({
        report: jest.fn()
      }, {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn()
      }));
    });
  });

  describe('树视图功能', () => {
    it('应该返回正确的树项', (): void => {
      const trackedFile = mockTrackedFiles[0];
      const fileItem = new FileItem(trackedFile, vscode.TreeItemCollapsibleState.None);
      const result = fileListProvider.getTreeItem(fileItem);

      expect(result).toBe(fileItem);
    });

    it('应该返回所有跟踪文件的树项列表', async (): Promise<void> => {
      const result = await fileListProvider.getChildren();

      expect(result).toBeDefined();
      expect(result.length).toBe(mockTrackedFiles.length);
      expect(result[0] instanceof FileItem).toBe(true);
      expect(result[1] instanceof FileItem).toBe(true);
    });

    it('应该为单个文件项返回空的子项列表', async (): Promise<void> => {
      const trackedFile = mockTrackedFiles[0];
      const fileItem = new FileItem(trackedFile, vscode.TreeItemCollapsibleState.None);
      const result = await fileListProvider.getChildren(fileItem);

      expect(result).toEqual([]);
    });

    it('应该正确刷新树视图', (): void => {
      // 监听onDidChangeTreeData事件
      const mockFire = jest.fn();
      const disposable = fileListProvider.onDidChangeTreeData(mockFire);
      
      // 调用刷新方法
      fileListProvider.refresh();

      // 验证事件被触发
      expect(mockFire).toHaveBeenCalled();
      
      // 清理监听器
      disposable.dispose();
    });
  });

  describe('文件上传功能', () => {
    beforeEach(() => {
      // 设置配置mock
      mockGetConfiguration.mockReturnValue({
        get: jest.fn().mockImplementation((key: string): string | undefined => {
          switch (key) {
          case 'sshConfigPath': return '/path/to/ssh/config';
          case 'remoteHost': return 'example.com';
          case 'remoteRootPath': return '/remote/path';
          default: return undefined;
          }
        }),
        has: jest.fn(),
        inspect: jest.fn(),
        update: jest.fn()
      } as vscode.WorkspaceConfiguration);

      // 设置工作区mock
      mockGetWorkspaceFolder.mockReturnValue({
        uri: {
          fsPath: '/path/to/repo'
        } as vscode.Uri,
        name: 'test-repo',
        index: 0
      } as vscode.WorkspaceFolder);

      // 设置文件系统mock
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('User test\nPort 22\nIdentityFile /path/to/key');
    });

    it('应该成功上传单个文件', async (): Promise<void> => {
      const fileItem = new FileItem(mockTrackedFiles[0], vscode.TreeItemCollapsibleState.None);

      // 调用上传方法
      await fileListProvider.uploadFile(fileItem);

      // 验证没有错误消息
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('应该在配置不完整时显示错误消息', async (): Promise<void> => {
      // 模拟不完整的配置
      mockGetConfiguration.mockReturnValue({
        get: jest.fn().mockReturnValue(''),
        has: jest.fn(),
        inspect: jest.fn(),
        update: jest.fn()
      } as vscode.WorkspaceConfiguration);

      const fileItem = new FileItem(mockTrackedFiles[0], vscode.TreeItemCollapsibleState.None);

      // 调用上传方法
      await fileListProvider.uploadFile(fileItem);

      // 验证显示错误消息
      expect(mockShowErrorMessage).toHaveBeenCalledWith('请先配置SSH连接信息');
    });

    it('应该在文件不存在时显示错误消息', async (): Promise<void> => {
      // 模拟文件不存在
      mockFs.existsSync.mockReturnValue(false);

      const fileItem = new FileItem(mockTrackedFiles[0], vscode.TreeItemCollapsibleState.None);

      // 调用上传方法
      await fileListProvider.uploadFile(fileItem);

      // 验证显示错误消息
      expect(mockShowErrorMessage).toHaveBeenCalled();
    });

    it('应该上传所有文件', async (): Promise<void> => {
      // 调用上传所有文件方法
      await fileListProvider.uploadAllFiles();

      // 验证没有错误消息
      expect(mockShowErrorMessage).not.toHaveBeenCalled();
    });

    it('应该在没有可上传文件时显示信息消息', async (): Promise<void> => {
      // 模拟没有跟踪的文件
      mockFileTracker.getTrackedFiles.mockReturnValue([]);

      // 调用上传所有文件方法
      await fileListProvider.uploadAllFiles();

      // 验证显示信息消息
      expect(mockShowInformationMessage).toHaveBeenCalledWith('没有可上传的文件');
    });
  });

  describe('文件移除功能', () => {
    it('应该在用户确认后移除文件', async (): Promise<void> => {
      // 模拟用户确认移除
      mockShowQuickPick.mockImplementationOnce(() => Promise.resolve('确定' as unknown as vscode.QuickPickItem));

      const fileItem = new FileItem(mockTrackedFiles[0], vscode.TreeItemCollapsibleState.None);

      // 调用移除方法
      await fileListProvider.removeFile(fileItem);

      // 验证文件被移除
      expect(mockFileTracker.removeFile).toHaveBeenCalledWith(mockTrackedFiles[0].filePath);
    });

    it('应该在用户取消时不移除文件', async (): Promise<void> => {
      // 模拟用户取消移除
      mockShowQuickPick.mockImplementationOnce(() => Promise.resolve('取消' as unknown as vscode.QuickPickItem));

      const fileItem = new FileItem(mockTrackedFiles[0], vscode.TreeItemCollapsibleState.None);

      // 调用移除方法
      await fileListProvider.removeFile(fileItem);

      // 验证文件没有被移除
      expect(mockFileTracker.removeFile).not.toHaveBeenCalled();
    });

    it('应该在移除失败时显示错误消息', async (): Promise<void> => {
      // 模拟用户确认移除
      mockShowQuickPick.mockImplementationOnce(() => Promise.resolve('确定' as unknown as vscode.QuickPickItem));

      // 模拟移除失败
      mockFileTracker.removeFile.mockImplementationOnce(() => false);

      const fileItem = new FileItem(mockTrackedFiles[0], vscode.TreeItemCollapsibleState.None);

      // 调用移除方法
      await fileListProvider.removeFile(fileItem);

      // 验证显示错误消息
      expect(mockShowErrorMessage).toHaveBeenCalled();
    });
  });
});
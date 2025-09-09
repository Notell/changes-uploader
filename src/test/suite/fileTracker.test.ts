import * as vscode from 'vscode';
import * as fs from 'fs';
import { FileTracker, ITrackedFile } from '../../fileTracker';

// Mock VS Code API
jest.mock('vscode', () => ({
  window: {
    createOutputChannel: jest.fn().mockReturnValue({
      appendLine: jest.fn(),
      dispose: jest.fn()
    })
  },
  workspace: {
    workspaceFolders: [],
    onDidChangeTextDocument: jest.fn(),
    onDidSaveTextDocument: jest.fn()
  },
  Uri: {
    file: (filePath: string): { fsPath: string } => ({ fsPath: filePath })
  }
}));

// Mock file system
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));
import * as child_process from 'child_process';
const mockExec = child_process.exec as jest.MockedFunction<typeof child_process.exec>;

const mockOutputChannel = vscode.window.createOutputChannel('Changes Uploader Test');

describe('FileTracker', () => {
  let fileTracker: FileTracker;
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
        get: jest.fn().mockReturnValue(null),
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

    // 创建FileTracker实例
    fileTracker = new FileTracker(mockContext, mockOutputChannel);
  });

  describe('构造函数和初始化', () => {
    it('应该正确初始化并从存储中加载跟踪的文件', (): void => {
      const mockStoredFiles: ITrackedFile[] = [
        {
          filePath: '/path/to/file1.txt',
          fileName: 'file1.txt',
          status: 'staged',
          lastModified: Date.now()
        }
      ];

      mockContext.globalState.get = jest.fn().mockReturnValue(mockStoredFiles);
      const tracker = new FileTracker(mockContext, mockOutputChannel);

      expect(tracker.getTrackedFiles()).toEqual(mockStoredFiles);
    });

    it('应该设置Git提交监听器', (): void => {
      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
    });
  });

  describe('文件跟踪功能', () => {
    it('应该添加和获取跟踪的文件', async (): Promise<void> => {
      // 设置模拟数据
      const mockGitStatus = ' M src/test.ts\nA  src/newfile.ts\n?? src/untracked.ts';
      const mockRepoRoot = '/path/to/repo';
      // const mockFilePath = '/path/to/repo/src/test.ts'; // 已注释未使用的变量
      
      mockExec.mockImplementation((cmd: string, opts: import('child_process').ExecOptions | null | undefined, callback?: (error: import('child_process').ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void) => {
        if (cmd.includes('rev-parse')) {
          callback?.(null, mockRepoRoot, '');
        } else if (cmd.includes('status')) {
          callback?.(null, mockGitStatus, '');
        } else {
          callback?.(new Error('未知命令'), '', '');
        }
        // 模拟返回ChildProcess对象
        return {
          kill: jest.fn(),
          stdin: null,
          stdout: null,
          stderr: null,
          stdio: [null, null, null, null, null],
          killed: false,
          pid: 12345,
          connected: false,
          exitCode: null,
          signalCode: null,
          spawnargs: [],
          spawnfile: '',
          on: jest.fn(),
          once: jest.fn(),
          off: jest.fn(),
          addListener: jest.fn(),
          removeListener: jest.fn(),
          emit: jest.fn(),
          removeAllListeners: jest.fn(),
          setMaxListeners: jest.fn(),
          getMaxListeners: jest.fn(),
          listeners: jest.fn(),
          rawListeners: jest.fn(),
          listenerCount: jest.fn(),
          prependListener: jest.fn(),
          prependOnceListener: jest.fn(),
          eventNames: jest.fn()
        } as unknown as import('child_process').ChildProcess;
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);

      // 更新文件状态
      await fileTracker.updateFileStatus();

      // 检查跟踪的文件
      const trackedFiles = fileTracker.getTrackedFiles();
      expect(trackedFiles.length).toBeGreaterThan(0);
    });

    it('应该正确移除文件', (): void => {
      const testFile: ITrackedFile = {
        filePath: '/path/to/file1.txt',
        fileName: 'file1.txt',
        status: 'staged',
        lastModified: Date.now()
      };

      // 手动添加文件
      (fileTracker as unknown as { trackedFiles: ITrackedFile[] }).trackedFiles = [testFile];

      // 移除文件
      const result = fileTracker.removeFile('/path/to/file1.txt');

      // 验证结果
      expect(result).toBe(true);
      expect(fileTracker.getTrackedFiles()).not.toContain(testFile);
    });

    it('应该检查文件是否已被跟踪', (): void => {
      const testFile: ITrackedFile = {
        filePath: '/path/to/file1.txt',
        fileName: 'file1.txt',
        status: 'staged',
        lastModified: Date.now()
      };

      // 手动添加文件
      // 使用类型断言访问私有属性
      (fileTracker as unknown as { trackedFiles: ITrackedFile[] }).trackedFiles = [testFile];

      // 移除文件
      fileTracker.removeFile('/path/to/file1.txt');

      // 检查文件是否被跟踪
      expect(fileTracker.isFileTracked('/path/to/file1.txt')).toBe(true);
      expect(fileTracker.isFileTracked('/path/to/file2.txt')).toBe(false);
    });
  });

  describe('事件监听器功能', () => {
    it('应该正确添加和移除状态监听器', (): void => {
      const mockListener1 = jest.fn();
      const mockListener2 = jest.fn();

      // 添加监听器
      fileTracker.addStatusListener(mockListener1);
      fileTracker.addStatusListener(mockListener2);

      // 触发状态变化通知
      // 使用类型断言访问私有方法
      (fileTracker as unknown as { notifyStatusChange: () => void }).notifyStatusChange();

      // 验证监听器被调用
      expect(mockListener1).toHaveBeenCalled();
      expect(mockListener2).toHaveBeenCalled();

      // 移除一个监听器
      fileTracker.removeStatusListener(mockListener1);
      
      // 重置mock
      mockListener1.mockClear();
      mockListener2.mockClear();

      // 再次触发状态变化通知
      // 使用类型断言访问私有方法
      (fileTracker as unknown as { notifyStatusChange: () => void }).notifyStatusChange();

      // 验证只有一个监听器被调用
      expect(mockListener1).not.toHaveBeenCalled();
      expect(mockListener2).toHaveBeenCalled();
    });
  });

  describe('Git相关功能', () => {
    it('应该正确查找Git仓库根目录', async (): Promise<void> => {
      const mockRepoRoot = '/path/to/repo';
      
      mockExec.mockImplementation((cmd: string, opts: import('child_process').ExecOptions | null | undefined, callback?: (error: import('child_process').ExecException | null, stdout: string, stderr: string) => void) => {
        if (cmd.includes('rev-parse')) {
          callback?.(null, mockRepoRoot, '');
        } else {
          callback?.(new Error('不是git仓库'), '', '');
        }
        // 模拟返回ChildProcess对象
        return {
          kill: jest.fn(),
          stdin: null,
          stdout: null,
          stderr: null,
          stdio: [null, null, null, null, null],
          killed: false,
          pid: 12345,
          connected: false,
          exitCode: null,
          signalCode: null,
          spawnargs: [],
          spawnfile: '',
          on: jest.fn(),
          once: jest.fn(),
          off: jest.fn(),
          addListener: jest.fn(),
          removeListener: jest.fn(),
          emit: jest.fn(),
          removeAllListeners: jest.fn(),
          setMaxListeners: jest.fn(),
          getMaxListeners: jest.fn(),
          listeners: jest.fn(),
          rawListeners: jest.fn(),
          listenerCount: jest.fn(),
          prependListener: jest.fn(),
          prependOnceListener: jest.fn(),
          eventNames: jest.fn()
        } as unknown as import('child_process').ChildProcess;
      });

      // 使用类型断言访问私有方法
      const result = await (fileTracker as unknown as { findGitRepositoryRoot: (path: string) => Promise<string | null> }).findGitRepositoryRoot('/path/to/repo/src');
      
      expect(result).toBe(mockRepoRoot);
    });

    it('在非Git仓库中应该返回null', async (): Promise<void> => {
      // 添加缺失的变量定义
      const mockRepoRoot = '/path/to/repo';
      const mockGitStatus = ' M src/test.ts\nA  src/newfile.ts\n?? src/untracked.ts';
      
      mockExec.mockImplementation((cmd: string, opts: import('child_process').ExecOptions | null | undefined, callback?: (error: import('child_process').ExecException | null, stdout: string, stderr: string) => void) => {
        if (cmd.includes('rev-parse')) {
          callback?.(null, mockRepoRoot, '');
        } else if (cmd.includes('status')) {
          callback?.(null, mockGitStatus, '');
        } else {
          callback?.(new Error('未知命令'), '', '');
        }
        // 模拟返回ChildProcess对象
        return {
          kill: jest.fn(),
          stdin: null,
          stdout: null,
          stderr: null,
          stdio: [null, null, null, null, null],
          killed: false,
          pid: 12345,
          connected: false,
          exitCode: null,
          signalCode: null,
          spawnargs: [],
          spawnfile: '',
          on: jest.fn(),
          once: jest.fn(),
          off: jest.fn(),
          addListener: jest.fn(),
          removeListener: jest.fn(),
          emit: jest.fn(),
          removeAllListeners: jest.fn(),
          setMaxListeners: jest.fn(),
          getMaxListeners: jest.fn(),
          listeners: jest.fn(),
          rawListeners: jest.fn(),
          listenerCount: jest.fn(),
          prependListener: jest.fn(),
          prependOnceListener: jest.fn(),
          eventNames: jest.fn()
        } as unknown as import('child_process').ChildProcess;
      });

      // 使用类型断言访问私有方法
      const result = await (fileTracker as unknown as { findGitRepositoryRoot: (path: string) => Promise<string | null> }).findGitRepositoryRoot('/path/to/none/repo');
      
      expect(result).toBe(null);
    });
  });
});
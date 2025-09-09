import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileTracker, TrackedFile } from '../../fileTracker';

// Mock VS Code API
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    onDidChangeTextDocument: jest.fn(),
    onDidSaveTextDocument: jest.fn()
  },
  Uri: {
    file: (filePath: string) => ({ fsPath: filePath })
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

describe('FileTracker', () => {
  let fileTracker: FileTracker;
  let mockContext: any;

  beforeEach(() => {
    // 重置所有mock
    jest.clearAllMocks();

    // 创建模拟的扩展上下文
    mockContext = {
      subscriptions: [],
      globalState: {
        get: jest.fn().mockReturnValue(null),
        update: jest.fn()
      }
    };

    // 创建FileTracker实例
    fileTracker = new FileTracker(mockContext as vscode.ExtensionContext);
  });

  describe('构造函数和初始化', () => {
    it('应该正确初始化并从存储中加载跟踪的文件', () => {
      const mockStoredFiles: TrackedFile[] = [
        {
          filePath: '/path/to/file1.txt',
          fileName: 'file1.txt',
          status: 'staged',
          lastModified: Date.now()
        }
      ];

      mockContext.globalState.get = jest.fn().mockReturnValue(mockStoredFiles);
      const tracker = new FileTracker(mockContext as vscode.ExtensionContext);

      expect(tracker.getTrackedFiles()).toEqual(mockStoredFiles);
    });

    it('应该设置Git提交监听器', () => {
      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
    });
  });

  describe('文件跟踪功能', () => {
    it('应该添加和获取跟踪的文件', async () => {
      // 设置模拟数据
      const mockGitStatus = ' M src/test.ts\nA  src/newfile.ts\n?? src/untracked.ts';
      const mockRepoRoot = '/path/to/repo';
      const mockFilePath = '/path/to/repo/src/test.ts';
      
      mockExec.mockImplementation((cmd: string, opts: any, callback?: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void) => {
        if (cmd.includes('rev-parse')) {
          callback?.(null, mockRepoRoot, '');
        } else if (cmd.includes('status')) {
          callback?.(null, mockGitStatus, '');
        } else {
          callback?.(new Error('未知命令'), '', '');
        }
        return { kill: jest.fn() } as any; // 模拟返回ChildProcess对象
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);

      // 更新文件状态
      await fileTracker.updateFileStatus();

      // 检查跟踪的文件
      const trackedFiles = fileTracker.getTrackedFiles();
      expect(trackedFiles.length).toBeGreaterThan(0);
    });

    it('应该正确移除文件', () => {
      const testFile: TrackedFile = {
        filePath: '/path/to/file1.txt',
        fileName: 'file1.txt',
        status: 'staged',
        lastModified: Date.now()
      };

      // 手动添加文件
      (fileTracker as any).trackedFiles = [testFile];

      // 移除文件
      const result = fileTracker.removeFile('/path/to/file1.txt');

      // 验证结果
      expect(result).toBe(true);
      expect(fileTracker.getTrackedFiles()).not.toContain(testFile);
    });

    it('应该检查文件是否已被跟踪', () => {
      const testFile: TrackedFile = {
        filePath: '/path/to/file1.txt',
        fileName: 'file1.txt',
        status: 'staged',
        lastModified: Date.now()
      };

      // 手动添加文件
      (fileTracker as any).trackedFiles = [testFile];

      // 检查文件是否被跟踪
      expect(fileTracker.isFileTracked('/path/to/file1.txt')).toBe(true);
      expect(fileTracker.isFileTracked('/path/to/file2.txt')).toBe(false);
    });
  });

  describe('事件监听器功能', () => {
    it('应该正确添加和移除状态监听器', () => {
      const mockListener1 = jest.fn();
      const mockListener2 = jest.fn();

      // 添加监听器
      fileTracker.addStatusListener(mockListener1);
      fileTracker.addStatusListener(mockListener2);

      // 触发状态变化通知
      (fileTracker as any).notifyStatusChange();

      // 验证监听器被调用
      expect(mockListener1).toHaveBeenCalled();
      expect(mockListener2).toHaveBeenCalled();

      // 移除一个监听器
      fileTracker.removeStatusListener(mockListener1);
      
      // 重置mock
      mockListener1.mockClear();
      mockListener2.mockClear();

      // 再次触发状态变化通知
      (fileTracker as any).notifyStatusChange();

      // 验证只有一个监听器被调用
      expect(mockListener1).not.toHaveBeenCalled();
      expect(mockListener2).toHaveBeenCalled();
    });
  });

  describe('Git相关功能', () => {
    it('应该正确查找Git仓库根目录', async () => {
      const mockRepoRoot = '/path/to/repo';
      
      mockExec.mockImplementation((cmd: string, opts: any, callback?: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void) => {
        if (cmd.includes('rev-parse')) {
          callback?.(null, mockRepoRoot, '');
        } else {
          callback?.(new Error('不是git仓库'), '', '');
        }
        return { kill: jest.fn() } as any; // 模拟返回ChildProcess对象
      });

      const result = await (fileTracker as any).findGitRepositoryRoot('/path/to/repo/src');
      
      expect(result).toBe(mockRepoRoot);
    });

    it('在非Git仓库中应该返回null', async () => {
      mockExec.mockImplementation((cmd: string, opts: any, callback?: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void) => {
        if (cmd.includes('rev-parse')) {
          callback?.(new Error('不是git仓库'), '', '');
        } else {
          callback?.(new Error('未知命令'), '', '');
        }
        return { kill: jest.fn() } as any; // 模拟返回ChildProcess对象
      });

      const result = await (fileTracker as any).findGitRepositoryRoot('/path/to/none/repo');
      
      expect(result).toBe(null);
    });
  });
});
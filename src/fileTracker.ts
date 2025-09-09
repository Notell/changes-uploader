import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 表示一个被跟踪的文件信息
 */
export interface TrackedFile {
  /** 文件完整路径 */
  filePath: string;
  /** 文件名 */
  fileName: string;
  /** 文件状态（staged, unstaged, untracked） */
  status: string;
  /** 最后修改时间 */
  lastModified: number;
}

/**
 * 文件跟踪器类，负责跟踪Git仓库中已修改的文件
 */
export class FileTracker {
  private context: vscode.ExtensionContext;
  private trackedFiles: TrackedFile[] = [];
  private fileStatusListeners: ((files: TrackedFile[]) => void)[] = [];
  private gitRepositories: Map<string, string> = new Map();

  /**
   * 构造函数
   * @param context VS Code扩展上下文
   */
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    
    // 从存储中恢复跟踪的文件列表
    this.loadTrackedFiles();
    
    // 监听Git提交事件，自动移除已提交的文件
    this.setupGitCommitListener();
  }

  /**
   * 添加文件状态变化监听器
   * @param listener 监听器函数
   */
  public addStatusListener(listener: (files: TrackedFile[]) => void): void {
    this.fileStatusListeners.push(listener);
  }

  /**
   * 移除文件状态变化监听器
   * @param listener 监听器函数
   */
  public removeStatusListener(listener: (files: TrackedFile[]) => void): void {
    const index = this.fileStatusListeners.indexOf(listener);
    if (index > -1) {
      this.fileStatusListeners.splice(index, 1);
    }
  }

  /**
   * 获取当前跟踪的所有文件
   * @returns 跟踪文件数组
   */
  public getTrackedFiles(): TrackedFile[] {
    return [...this.trackedFiles];
  }

  /**
   * 手动移除文件
   * @param filePath 文件路径
   * @returns 是否移除成功
   */
  public removeFile(filePath: string): boolean {
    const initialLength = this.trackedFiles.length;
    this.trackedFiles = this.trackedFiles.filter(file => file.filePath !== filePath);
    
    if (initialLength !== this.trackedFiles.length) {
      this.saveTrackedFiles();
      this.notifyStatusChange();
      return true;
    }
    
    return false;
  }

  /**
   * 检查文件是否已被跟踪
   * @param filePath 文件路径
   * @returns 是否已跟踪
   */
  public isFileTracked(filePath: string): boolean {
    return this.trackedFiles.some(file => file.filePath === filePath);
  }

  /**
   * 更新文件状态
   */
  public async updateFileStatus(): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return;
      }

      for (const folder of workspaceFolders) {
        const repoRoot = await this.findGitRepositoryRoot(folder.uri.fsPath);
        if (repoRoot) {
          this.gitRepositories.set(folder.uri.fsPath, repoRoot);
          await this.scanGitStatus(repoRoot);
        }
      }

      this.saveTrackedFiles();
      this.notifyStatusChange();
    } catch (error) {
      console.error('更新文件状态失败:', error);
    }
  }

  /**
   * 扫描Git状态
   * @param repoRoot Git仓库根目录
   */
  private async scanGitStatus(repoRoot: string): Promise<void> {
    try {
      const result = await this.executeGitCommand(repoRoot, ['status', '--porcelain']);
      const lines = result.stdout.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        const statusCode = line.substring(0, 2).trim();
        const filePath = path.join(repoRoot, line.substring(3).trim());
        
        if (fs.existsSync(filePath)) {
          const fileStats = fs.statSync(filePath);
          const fileName = path.basename(filePath);
          
          // 确定文件状态
          let status = 'unstaged';
          if (statusCode.startsWith('A') || statusCode.startsWith('M')) {
            status = 'staged';
          } else if (statusCode.startsWith('?')) {
            status = 'untracked';
          }

          // 检查文件是否已存在于跟踪列表中
          const existingIndex = this.trackedFiles.findIndex(f => f.filePath === filePath);
          
          if (existingIndex >= 0) {
            // 更新现有文件
            this.trackedFiles[existingIndex].status = status;
            this.trackedFiles[existingIndex].lastModified = fileStats.mtimeMs;
          } else {
            // 添加新文件
            this.trackedFiles.push({
              filePath,
              fileName,
              status,
              lastModified: fileStats.mtimeMs
            });
          }
        }
      }
    } catch (error) {
      console.error('扫描Git状态失败:', error);
    }
  }

  /**
   * 查找Git仓库根目录
   * @param startPath 起始路径
   * @returns Git仓库根目录或null
   */
  private async findGitRepositoryRoot(startPath: string): Promise<string | null> {
    try {
      const result = await this.executeGitCommand(startPath, ['rev-parse', '--show-toplevel']);
      return result.stdout.trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * 执行Git命令
   * @param cwd 工作目录
   * @param args 命令参数
   * @returns 命令执行结果
   */
  private executeGitCommand(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      child_process.exec(`git ${args.join(' ')}`, { cwd }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /**
   * 设置Git提交监听器
   */
  private setupGitCommitListener(): void {
    // 通过文件系统监听来检测Git提交
    const disposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.fileName.endsWith('.git/COMMIT_EDITMSG')) {
        await this.handleGitCommit();
      }
    });

    this.context.subscriptions.push(disposable);
  }

  /**
   * 处理Git提交事件
   */
  private async handleGitCommit(): Promise<void> {
    try {
      // 获取所有Git仓库
      for (const [_, repoRoot] of this.gitRepositories) {
        // 获取最近一次提交的文件列表
        const result = await this.executeGitCommand(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
        const committedFiles = result.stdout.split('\n').filter(line => line.trim() !== '').map(file => path.join(repoRoot, file));
        
        // 移除已提交的文件
        this.trackedFiles = this.trackedFiles.filter(file => !committedFiles.includes(file.filePath));
      }

      this.saveTrackedFiles();
      this.notifyStatusChange();
    } catch (error) {
      console.error('处理Git提交事件失败:', error);
    }
  }

  /**
   * 保存跟踪的文件列表到存储
   */
  private saveTrackedFiles(): void {
    this.context.globalState.update('trackedFiles', this.trackedFiles);
  }

  /**
   * 从存储中加载跟踪的文件列表
   */
  private loadTrackedFiles(): void {
    const storedFiles = this.context.globalState.get<TrackedFile[]>('trackedFiles') || [];
    this.trackedFiles = storedFiles;
  }

  /**
   * 通知所有监听器文件状态变化
   */
  private notifyStatusChange(): void {
    for (const listener of this.fileStatusListeners) {
      listener(this.getTrackedFiles());
    }
  }
}
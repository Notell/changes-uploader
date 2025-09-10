import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 表示一个被跟踪的文件信息
 */
export interface ITrackedFile {
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
  private trackedFiles: ITrackedFile[] = [];
  private fileStatusListeners: ((files: ITrackedFile[]) => void)[] = [];
  private gitRepositories: Map<string, string> = new Map();
  private outputChannel: vscode.OutputChannel;

  /**
   * 构造函数
   * @param context VS Code扩展上下文
   * @param outputChannel VS Code输出通道
   */
  constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.context = context;
    this.outputChannel = outputChannel;
    
    // 从存储中恢复跟踪的文件列表
    this.loadTrackedFiles();
    
    // 监听Git提交事件，自动移除已提交的文件
    this.setupGitCommitListener();
  }

  /**
   * 添加文件状态变化监听器
   * @param listener 监听器函数
   */
  public addStatusListener(listener: (files: ITrackedFile[]) => void): void {
    this.fileStatusListeners.push(listener);
  }

  /**
   * 移除文件状态变化监听器
   * @param listener 监听器函数
   */
  public removeStatusListener(listener: (files: ITrackedFile[]) => void): void {
    const index = this.fileStatusListeners.indexOf(listener);
    if (index > -1) {
      this.fileStatusListeners.splice(index, 1);
    }
  }

  /**
   * 获取当前跟踪的所有文件
   * @returns 跟踪文件数组
   */
  public getTrackedFiles(): ITrackedFile[] {
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
        this.outputChannel.appendLine('没有工作区文件夹');
        vscode.window.showInformationMessage('Changes Uploader: 没有打开的工作区文件夹');
        // 即使没有工作区文件夹，也要通知状态变化，确保面板能正确刷新
        this.notifyStatusChange();
        return;
      }

      this.outputChannel.appendLine(`找到 ${workspaceFolders.length} 个工作区文件夹`);
      let foundAnyRepo = false;
      
      for (const folder of workspaceFolders) {
        this.outputChannel.appendLine(`检查文件夹: ${folder.uri.fsPath}`);
        const repoRoot = await this.findGitRepositoryRoot(folder.uri.fsPath);
        if (repoRoot) {
          foundAnyRepo = true;
          this.outputChannel.appendLine(`找到Git仓库: ${repoRoot}`);
          this.gitRepositories.set(folder.uri.fsPath, repoRoot);
          await this.scanGitStatus(repoRoot);
        } else {
          this.outputChannel.appendLine(`未在 ${folder.uri.fsPath} 找到Git仓库`);
        }
      }

      if (!foundAnyRepo) {
        this.outputChannel.appendLine('未找到任何Git仓库');
        vscode.window.showInformationMessage('Changes Uploader: 未在工作区找到Git仓库');
      }

      this.outputChannel.appendLine(`跟踪的文件数量: ${this.trackedFiles.length}`);
      if (this.trackedFiles.length > 0) {
        this.outputChannel.appendLine(`跟踪的文件: ${this.trackedFiles.map(f => f.fileName).join(', ')}`);
        vscode.window.showInformationMessage(`Changes Uploader: 已找到 ${this.trackedFiles.length} 个修改的文件`);
      } else {
        // 即使没有跟踪的文件，也要显示信息
        vscode.window.showInformationMessage('Changes Uploader: 当前没有修改的文件');
      }

      this.saveTrackedFiles();
      this.notifyStatusChange();
    } catch (error) {
      this.outputChannel.appendLine(`更新文件状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
      vscode.window.showErrorMessage(`更新文件状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
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

      // 存储扫描到的文件路径，用于后续清理
      const scannedFilePaths = new Set<string>();

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
          
          // 添加到扫描集合
          scannedFilePaths.add(filePath);
        }
      }
      
    } catch (error) {
      this.outputChannel.appendLine(`扫描Git状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
      // 显示错误信息给用户
      vscode.window.showErrorMessage(`扫描Git状态失败: ${error instanceof Error ? error.message : '未知错误'}`);
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
    // 确保命令正确格式化，处理路径中的空格
    const command = `git ${args.map(arg => {
      // 如果参数包含空格，用双引号包裹
      return arg.includes(' ') ? `"${arg}"` : arg;
    }).join(' ')}`;
    
    this.outputChannel.appendLine(`执行Git命令: ${command} (在目录: ${cwd})`);
    
    return new Promise((resolve, reject) => {
      child_process.exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Git命令执行失败: ${error.message}`);
          this.outputChannel.appendLine(`错误输出: ${stderr}`);
          reject(error);
        } else {
          this.outputChannel.appendLine(`Git命令执行成功: ${stdout}`);
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
      for (const [, repoRoot] of this.gitRepositories) {
        // 获取最近一次提交的文件列表
        const result = await this.executeGitCommand(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
        const committedFiles = result.stdout.split('\n').filter(line => line.trim() !== '').map(file => path.join(repoRoot, file));
        
        // 移除已提交的文件
        this.trackedFiles = this.trackedFiles.filter(file => !committedFiles.includes(file.filePath));
      }

      this.saveTrackedFiles();
      this.notifyStatusChange();
    } catch (error) {
      this.outputChannel.appendLine(`处理Git提交事件失败: ${error instanceof Error ? error.message : '未知错误'}`);
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
    const storedFiles = this.context.globalState.get<ITrackedFile[]>('trackedFiles') || [];
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
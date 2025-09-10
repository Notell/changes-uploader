import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import Client from 'ssh2-sftp-client';
import { FileTracker, ITrackedFile } from './fileTracker';

/**
 * 表示树视图中的文件项
 */
export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly trackedFile: ITrackedFile,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(trackedFile.fileName, collapsibleState);
    
    // 设置工具提示为完整文件路径
    this.tooltip = trackedFile.filePath;
    
    // 设置上下文值以便在package.json中针对不同类型的节点定义命令
    this.contextValue = 'fileItem';
    
    // 设置图标根据文件状态
    this.iconPath = this.getFileIconPath();
    
    // 设置命令
    this.command = {
      title: '查看文件',
      command: 'vscode.open',
      arguments: [vscode.Uri.file(this.trackedFile.filePath)]
    };
  }

  /**
   * 根据文件状态返回图标路径
   */
  private getFileIconPath(): vscode.ThemeIcon {
    switch (this.trackedFile.status) {
    case 'staged':
      return new vscode.ThemeIcon('check-circle');
    case 'unstaged':
      return new vscode.ThemeIcon('circle');
    case 'untracked':
      return new vscode.ThemeIcon('question');
    default:
      return new vscode.ThemeIcon('file');
    }
  }


}

/**
 * 文件列表提供者类，实现VS Code的TreeDataProvider接口
 */
export class FileListProvider implements vscode.TreeDataProvider<FileItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<FileItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private fileTracker: FileTracker;
  private context: vscode.ExtensionContext;
  private outputChannel: vscode.OutputChannel;

  /**
   * 构造函数
   * @param fileTracker 文件跟踪器实例
   * @param context VS Code扩展上下文
   * @param outputChannel VS Code输出通道
   */
  constructor(fileTracker: FileTracker, context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.fileTracker = fileTracker;
    this.context = context;
    this.outputChannel = outputChannel;
    
    // 添加文件状态变化监听器
    this.fileTracker.addStatusListener(() => {
      this.refresh('fileTrackerStatusChange');
    });
  }

  /**
   * 获取树项
   * @param element 树项元素
   * @returns 树项数据
   */
  public getTreeItem(element: FileItem): vscode.TreeItem {
    // this.outputChannel.appendLine(`获取树项: ${element.trackedFile.fileName} 状态: ${element.trackedFile.status}`);
    return element;
  }

  /**
   * 获取子树项
   * @param element 父树项元素
   * @returns 子树项数组
   */
  public getChildren(element?: FileItem): Thenable<FileItem[]> {
    if (element) {
      // 文件项没有子项
      return Promise.resolve([]);
    }

    // 获取所有跟踪的文件并转换为树项
    const trackedFiles = this.fileTracker.getTrackedFiles();
    const fileItems = trackedFiles.map(file => 
      new FileItem(file, vscode.TreeItemCollapsibleState.None)
    );

    return Promise.resolve(fileItems);
  }

  /**
   * 刷新树视图
   */
  public refresh(source: string): void {
    this.outputChannel.appendLine(`[${source}] 刷新树视图，当前跟踪文件数: ${this.fileTracker.getTrackedFiles().length}`);
    this._onDidChangeTreeData.fire();
  }

  /**
   * 上传单个文件
   * @param file 文件项或文件路径
   */
  public async uploadFile(file: FileItem | string): Promise<void> {
    try {
      // 获取文件路径
      const filePath = typeof file === 'string' ? file : file.trackedFile.filePath;
      
      if (!fs.existsSync(filePath)) {
        this.outputChannel.appendLine(`文件不存在: ${filePath}`);
        vscode.window.showErrorMessage(`文件不存在: ${filePath}`);
        return;
      }

      // 获取配置信息
      const config = vscode.workspace.getConfiguration('changesUploader');
      const sshConfigPath = config.get<string>('sshConfigPath', '');
      const remoteHost = config.get<string>('remoteHost', '');
      const remoteRootPath = config.get<string>('remoteRootPath', '');

      // 验证配置
      if (!sshConfigPath || !remoteHost || !remoteRootPath) {
        this.outputChannel.appendLine('请先配置SSH连接信息');
        vscode.window.showErrorMessage('请先配置SSH连接信息');
        vscode.commands.executeCommand('workbench.action.openSettings', 'changesUploader');
        return;
      }

      // 开始上传文件
      const progressOptions: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: `正在上传文件: ${path.basename(filePath)}`
      };

      await vscode.window.withProgress(progressOptions, async (progress) => {
        progress.report({ increment: 0 });
        
        try {
          await this.sftpUploadFile(sshConfigPath, remoteHost, filePath, remoteRootPath);
          progress.report({ increment: 100 });
          this.outputChannel.appendLine(`文件上传成功: ${path.basename(filePath)}`);
          vscode.window.showInformationMessage(`文件上传成功: ${path.basename(filePath)}`);
        } catch (error) {
          this.outputChannel.appendLine(`文件上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
          vscode.window.showErrorMessage(`文件上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
      });
    } catch (error) {
      this.outputChannel.appendLine(`上传文件时发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
      vscode.window.showErrorMessage(`上传文件时发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 上传所有文件
   */
  public async uploadAllFiles(): Promise<void> {
    const trackedFiles = this.fileTracker.getTrackedFiles();
    
    if (trackedFiles.length === 0) {
      this.outputChannel.appendLine('没有可上传的文件');
      vscode.window.showInformationMessage('没有可上传的文件');
      return;
    }

    // 获取配置信息
    const config = vscode.workspace.getConfiguration('changesUploader');
    const sshConfigPath = config.get<string>('sshConfigPath', '');
    const remoteHost = config.get<string>('remoteHost', '');
    const remoteRootPath = config.get<string>('remoteRootPath', '');

    // 验证配置
    if (!sshConfigPath || !remoteHost || !remoteRootPath) {
      this.outputChannel.appendLine('请先配置SSH连接信息');
      vscode.window.showErrorMessage('请先配置SSH连接信息');
      vscode.commands.executeCommand('workbench.action.openSettings', 'changesUploader');
      return;
    }

    // 开始批量上传
    const progressOptions: vscode.ProgressOptions = {
      location: vscode.ProgressLocation.Notification,
      title: '正在上传所有文件',
      cancellable: true
    };

    let cancelled = false;
    let successCount = 0;
    let errorCount = 0;

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
      token.onCancellationRequested(() => {
        cancelled = true;
      });

      for (let i = 0; i < trackedFiles.length; i++) {
        if (cancelled) break;

        const file = trackedFiles[i];
        progress.report({
          increment: (100 / trackedFiles.length),
          message: `正在上传: ${file.fileName}`
        });

        try {
          if (fs.existsSync(file.filePath)) {
            await this.sftpUploadFile(sshConfigPath, remoteHost, file.filePath, remoteRootPath);
            successCount++;
          } else {
            errorCount++;
          }
        } catch (error) {
          this.outputChannel.appendLine(`上传文件失败: ${file.filePath} - ${error instanceof Error ? error.message : '未知错误'}`);
          errorCount++;
        }
      }
    });

    // 显示上传结果
    if (cancelled) {
      this.outputChannel.appendLine(`上传已取消，已成功上传 ${successCount} 个文件，失败 ${errorCount} 个文件`);
      vscode.window.showInformationMessage(`上传已取消，已成功上传 ${successCount} 个文件，失败 ${errorCount} 个文件`);
    } else {
      this.outputChannel.appendLine(`上传完成，共上传 ${successCount} 个文件，失败 ${errorCount} 个文件`);
      vscode.window.showInformationMessage(`上传完成，共上传 ${successCount} 个文件，失败 ${errorCount} 个文件`);
    }
  }

  /**
   * 移除文件
   * @param file 文件项或文件路径
   */
  public async removeFile(file: FileItem | string): Promise<void> {
    const filePath = typeof file === 'string' ? file : file.trackedFile.filePath;
    const fileName = typeof file === 'string' ? path.basename(filePath) : file.trackedFile.fileName;

    const confirm = await vscode.window.showQuickPick(
      ['确定', '取消'],
      {
        placeHolder: `确定要永久移除文件 "${fileName}" 吗？`,
        canPickMany: false
      }
    );

    if (confirm === '确定') {
      const success = this.fileTracker.removeFile(filePath);
      if (success) {
        this.outputChannel.appendLine(`已移除文件: ${fileName}`);
        vscode.window.showInformationMessage(`已移除文件: ${fileName}`);
        this.refresh('fileRemoval');
      } else {
        this.outputChannel.appendLine(`移除文件失败: ${fileName}`);
        vscode.window.showErrorMessage(`移除文件失败: ${fileName}`);
      }
    }
  }

  /**
   * 使用SFTP上传文件
   * @param sshConfigPath SSH配置文件路径
   * @param remoteHost 远程主机名
   * @param localFilePath 本地文件路径
   * @param remoteRootPath 远程根目录路径
   */
  private async sftpUploadFile(sshConfigPath: string, remoteHost: string, localFilePath: string, remoteRootPath: string): Promise<void> {
    const sftp = new Client();
    
    try {
      // 读取SSH配置文件
      const sshConfig = this.readSSHConfig(sshConfigPath);
      
      // 连接到远程服务器
      await sftp.connect({
        host: remoteHost,
        port: sshConfig.port || 22,
        username: sshConfig.user,
        privateKey: sshConfig.privateKey ? fs.readFileSync(sshConfig.privateKey, 'utf8') : undefined,
        passphrase: sshConfig.passphrase
      });

      // 确定远程文件路径
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(localFilePath));
      if (!workspaceFolder) {
        throw new Error(`无法确定文件 ${localFilePath} 所属的工作区`);
      }

      // 计算相对于工作区根目录的路径
      const relativePath = path.relative(workspaceFolder.uri.fsPath, localFilePath);
      const remoteFilePath = path.posix.join(remoteRootPath.replace(/\\/g, '/'), relativePath.replace(/\\/g, '/'));
      
      // 确保远程目录存在
      const remoteDir = path.posix.dirname(remoteFilePath);
      try {
        await sftp.mkdir(remoteDir, true);
      } catch (error) {
        // 忽略目录已存在的错误
      }

      // 上传文件
      await sftp.put(localFilePath, remoteFilePath);
    } finally {
      // 确保关闭连接
      await sftp.end();
    }
  }

  /**
   * 读取SSH配置文件
   * @param configPath 配置文件路径
   * @returns SSH配置对象
   */
  private readSSHConfig(configPath: string): { user?: string; port?: number; privateKey?: string; passphrase?: string } {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const configLines = configContent.split('\n');
      const config: { user?: string; port?: number; privateKey?: string; passphrase?: string } = {};

      for (const line of configLines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('User ')) {
          config.user = trimmedLine.substring(5).trim();
        } else if (trimmedLine.startsWith('Port ')) {
          config.port = parseInt(trimmedLine.substring(5).trim());
        } else if (trimmedLine.startsWith('IdentityFile ')) {
          config.privateKey = trimmedLine.substring(13).trim();
        }
        // 注意：出于安全考虑，passphrase通常不会直接存储在配置文件中
      }

      return config;
    } catch (error) {
      this.outputChannel.appendLine(`读取SSH配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
      throw new Error(`读取SSH配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
}
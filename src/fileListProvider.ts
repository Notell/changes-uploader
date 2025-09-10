import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Client from 'ssh2-sftp-client';
import { SFTPWrapper } from 'ssh2';
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
      case 'modified':
        return new vscode.ThemeIcon('pencil');
      case 'untracked':
        return new vscode.ThemeIcon('diff-added');
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
      this.outputChannel.appendLine('没有需要上传的文件');
      vscode.window.showInformationMessage('没有需要上传的文件');
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

    // 开始上传所有文件
    const progressOptions: vscode.ProgressOptions = {
      location: vscode.ProgressLocation.Notification,
      title: '正在上传所有文件',
      cancellable: true
    };

    await vscode.window.withProgress(progressOptions, async (progress, token) => {
      progress.report({ increment: 0, message: '准备上传...' });

      let uploadedCount = 0;
      const totalFiles = trackedFiles.length;
      let sftp: Client | null = null;

      try {
        // 读取SSH配置（如果存在）
        const config = await this.readSSHConfig(sshConfigPath, remoteHost);
        // 建立SFTP连接
        const client = new Client();
        const actualHost = config.hostName || remoteHost;
        await client.connect({
          host: actualHost,
          port: config.port || 22,
          username: config.user,
          privateKey: config.privateKey ? fs.readFileSync(config.privateKey, 'utf8') : undefined
        });
        sftp = client;

        // 上传每个文件
        for (const file of trackedFiles) {
          if (token.isCancellationRequested) {
            this.outputChannel.appendLine('用户取消了上传操作');
            break;
          }

          try {
            const increment = (100 / totalFiles) * uploadedCount;
            progress.report({ increment, message: `正在上传: ${path.basename(file.filePath)}` });

            await this.sftpUploadFileWithConnection(sftp, file.filePath, remoteRootPath);
            uploadedCount++;
            this.outputChannel.appendLine(`文件上传成功: ${path.basename(file.filePath)}`);
          } catch (error) {
            this.outputChannel.appendLine(`文件上传失败: ${path.basename(file.filePath)}, 错误: ${error instanceof Error ? error.message : '未知错误'}`);
            vscode.window.showErrorMessage(`文件上传失败: ${path.basename(file.filePath)}`);
          }
        }

        // 完成上传
        progress.report({ increment: 100, message: '上传完成' });
        this.outputChannel.appendLine(`批量上传完成，成功上传 ${uploadedCount}/${totalFiles} 个文件`);
        vscode.window.showInformationMessage(`批量上传完成，成功上传 ${uploadedCount}/${totalFiles} 个文件`);
      } catch (error) {
        this.outputChannel.appendLine(`批量上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
        vscode.window.showErrorMessage(`批量上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        // 关闭SFTP连接
        if (sftp) {
          await sftp.end();
        }
        this.outputChannel.appendLine('SFTP连接已关闭');
      }
    });
  }

  /**
   * 移除文件
   * @param file 文件项或文件路径
   */
  public async removeFile(file: FileItem | string): Promise<void> {
    const filePath = typeof file === 'string' ? file : file.trackedFile.filePath;
    const fileName = typeof file === 'string' ? path.basename(filePath) : file.trackedFile.fileName;
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

  /**
   * 使用已建立的SFTP连接上传文件
   * @param sftp 已连接的SFTP客户端实例
   * @param localFilePath 本地文件路径
   * @param remoteRootPath 远程根目录路径
   */
  private async sftpUploadFileWithConnection(sftp: Client, localFilePath: string, remoteRootPath: string): Promise<void> {
    try {
      // 确定远程文件路径
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(localFilePath));
      if (!workspaceFolder) {
        throw new Error(`无法确定文件 ${localFilePath} 所属的工作区`);
      }

      // 计算相对于工作区根目录的路径
      const relativePath = path.relative(workspaceFolder.uri.fsPath, localFilePath);
      const remoteFilePath = path.posix.join(remoteRootPath.replace(/\\/g, '/'), relativePath.replace(/\\/g, '/'));

      this.outputChannel.appendLine(`本地文件路径: ${localFilePath}`);
      this.outputChannel.appendLine(`远程文件路径: ${remoteFilePath}`);

      // 确保远程目录存在
      const remoteDir = path.posix.dirname(remoteFilePath);
      try {
        await sftp.mkdir(remoteDir, true);
        this.outputChannel.appendLine(`创建远程目录: ${remoteDir}`);
      } catch (error) {
        // 忽略目录已存在的错误
        this.outputChannel.appendLine(`创建远程目录时遇到问题: ${error instanceof Error ? error.message : '未知错误'}`);
      }

      // 上传文件
      await sftp.put(localFilePath, remoteFilePath);
      this.outputChannel.appendLine(`文件上传成功: ${localFilePath} -> ${remoteFilePath}`);
    } catch (error) {
      this.outputChannel.appendLine(`SFTP上传过程中发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
      if (error instanceof Error && error.stack) {
        this.outputChannel.appendLine(`错误堆栈: ${error.stack}`);
      }
      throw error;
    }
  }

  /**
   * 使用SFTP上传文件
   * @param sshConfigPath SSH配置文件路径
   * @param remoteHost 远程主机名
   * @param localFilePath 本地文件路径
   * @param remoteRootPath 远程根目录路径
   * @param sshConfig SSH配置对象（可选）
   */
  private async sftpUploadFile(sshConfigPath: string, remoteHost: string, localFilePath: string, remoteRootPath: string, sshConfig?: { hostName?: string; user?: string; port?: number; privateKey?: string }): Promise<void> {
    let sftp: Client | null = null;
    let client: Client | null = null;
    try {
      // 如果没有提供sshConfig，则读取SSH配置文件
      const config = sshConfig || await this.readSSHConfig(sshConfigPath, remoteHost);

      // 验证配置是否完整
      if (!config.user) {
        throw new Error('SSH配置缺少用户名');
      }

      if (!config.privateKey) {
        throw new Error('SSH配置缺少私钥文件路径');
      }

      if (!fs.existsSync(config.privateKey)) {
        throw new Error(`私钥文件不存在: ${config.privateKey}`);
      }

      // 使用HostName（如果存在），否则使用传入的remoteHost
      const actualHost = config.hostName || remoteHost;

      this.outputChannel.appendLine(`开始连接到远程服务器: ${remoteHost} (实际地址: ${actualHost})`);
      this.outputChannel.appendLine(`连接参数: host=${actualHost}, port=${config.port || 22}, username=${config.user}`);

      // 建立SFTP连接
      client = new Client();
      await client.connect({
        host: actualHost,
        port: config.port || 22,
        username: config.user,
        privateKey: config.privateKey ? fs.readFileSync(config.privateKey, 'utf8') : undefined
      });
      sftp = client;

      this.outputChannel.appendLine('SFTP连接成功');

      // 确定远程文件路径
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(localFilePath));
      if (!workspaceFolder) {
        throw new Error(`无法确定文件 ${localFilePath} 所属的工作区`);
      }

      // 计算相对于工作区根目录的路径
      const relativePath = path.relative(workspaceFolder.uri.fsPath, localFilePath);
      const remoteFilePath = path.posix.join(remoteRootPath.replace(/\\/g, '/'), relativePath.replace(/\\/g, '/'));

      this.outputChannel.appendLine(`本地文件路径: ${localFilePath}`);
      this.outputChannel.appendLine(`远程文件路径: ${remoteFilePath}`);

      // 确保远程目录存在
      const remoteDir = path.posix.dirname(remoteFilePath);
      try {
        await sftp.mkdir(remoteDir, true);
        this.outputChannel.appendLine(`创建远程目录: ${remoteDir}`);
      } catch (error) {
        // 忽略目录已存在的错误
        this.outputChannel.appendLine(`创建远程目录时遇到问题: ${error instanceof Error ? error.message : '未知错误'}`);
      }

      // 上传文件
      await sftp.put(localFilePath, remoteFilePath);
      this.outputChannel.appendLine(`文件上传成功: ${localFilePath} -> ${remoteFilePath}`);
    } catch (error) {
      this.outputChannel.appendLine(`SFTP上传过程中发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
      if (error instanceof Error && error.stack) {
        this.outputChannel.appendLine(`错误堆栈: ${error.stack}`);
      }
      throw error;
    } finally {
      // 确保关闭连接
      try {
        if (sftp) {
          await sftp.end();
        }
        this.outputChannel.appendLine('SFTP连接已关闭');
      } catch (error) {
        this.outputChannel.appendLine(`关闭SFTP连接时发生错误: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  }

  /**
   * 读取SSH配置文件
   * @param configPath 配置文件路径
   * @param host 主机名，用于只读取对应主机的配置
   * @returns SSH配置对象
   */
  private readSSHConfig(configPath: string, host: string): { hostName?: string; user?: string; port?: number; privateKey?: string } {
    try {
      // 获取系统默认的SSH配置文件路径
      const homeDir = os.homedir();
      const defaultSSHConfigPath = path.join(homeDir, '.ssh', 'config');

      // 检查系统默认的SSH配置文件是否存在
      let configFileToRead = defaultSSHConfigPath;
      if (!fs.existsSync(defaultSSHConfigPath)) {
        // 如果系统默认的配置文件不存在，尝试使用传入的路径
        if (configPath && fs.existsSync(configPath)) {
          configFileToRead = configPath;
        } else {
          throw new Error(`SSH配置文件不存在: ${defaultSSHConfigPath}`);
        }
      }

      this.outputChannel.appendLine(`读取SSH配置文件: ${configFileToRead}`);
      this.outputChannel.appendLine(`目标主机: ${host}`);

      const configContent = fs.readFileSync(configFileToRead, 'utf8');
      const configLines = configContent.split('\n');
      const config: { hostName?: string; user?: string; port?: number; privateKey?: string } = {};

      // 只解析对应主机的配置
      let inTargetHostSection = false;
      let currentHosts: string[] = [];

      for (const line of configLines) {
        const trimmedLine = line.trim();

        // 跳过注释和空行
        if (trimmedLine.startsWith('#') || trimmedLine.length === 0) {
          continue;
        }

        // 检查是否是新的Host部分
        if (trimmedLine.toLowerCase().startsWith('host ')) {
          // 提取主机名列表
          const hostLine = trimmedLine.substring(5).trim();
          currentHosts = hostLine.split(/\s+/).map(h => h.trim());

          // 检查当前主机是否匹配目标主机
          inTargetHostSection = currentHosts.includes(host);
          this.outputChannel.appendLine(`发现Host行: ${hostLine}, 当前主机: ${currentHosts.join(', ')}, 匹配: ${inTargetHostSection}`);
          continue;
        }

        // 如果在目标主机部分，则解析配置项
        if (inTargetHostSection) {
          // 解析HostName配置
          if (trimmedLine.toLowerCase().startsWith('hostname ')) {
            config.hostName = trimmedLine.substring(9).trim();
            this.outputChannel.appendLine(`解析到HostName: ${config.hostName}`);
          }
          // 解析User配置
          else if (trimmedLine.toLowerCase().startsWith('user ')) {
            config.user = trimmedLine.substring(5).trim();
            this.outputChannel.appendLine(`解析到User: ${config.user}`);
          }
          // 解析Port配置
          else if (trimmedLine.toLowerCase().startsWith('port ')) {
            const portStr = trimmedLine.substring(5).trim();
            const port = parseInt(portStr, 10);
            if (!isNaN(port)) {
              config.port = port;
              this.outputChannel.appendLine(`解析到Port: ${config.port}`);
            }
          }
          // 解析IdentityFile配置
          else if (trimmedLine.toLowerCase().startsWith('identityfile ')) {
            let identityFile = trimmedLine.substring(13).trim();

            // 处理波浪号路径
            if (identityFile.startsWith('~')) {
              identityFile = path.join(homeDir, identityFile.substring(1));
            }

            config.privateKey = identityFile;
            this.outputChannel.appendLine(`解析到IdentityFile: ${config.privateKey}`);
          }
        }
      }

      this.outputChannel.appendLine(`最终配置: ${JSON.stringify(config)}`);
      return config;
    } catch (error) {
      this.outputChannel.appendLine(`读取SSH配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
      throw new Error(`读取SSH配置文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
}
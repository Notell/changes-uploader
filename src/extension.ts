import * as vscode from 'vscode';
import { FileTracker } from './fileTracker';
import { FileListProvider } from './fileListProvider';

/**
 * 插件激活函数
 * @param context VS Code扩展上下文
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Changes Uploader 插件已激活');

  // 创建文件跟踪器实例
  const fileTracker = new FileTracker(context);

  // 创建文件列表提供者实例
  const fileListProvider = new FileListProvider(fileTracker, context);

  // 注册侧边栏视图
  vscode.window.registerTreeDataProvider('changes-uploader.fileList', fileListProvider);

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('changes-uploader.uploadAllFiles', () => {
      fileListProvider.uploadAllFiles();
    }),
    
    vscode.commands.registerCommand('changes-uploader.uploadFile', (file) => {
      fileListProvider.uploadFile(file);
    }),
    
    vscode.commands.registerCommand('changes-uploader.removeFile', (file) => {
      fileListProvider.removeFile(file);
    })
  );

  // 监听Git事件，更新文件列表
  vscode.workspace.onDidChangeTextDocument(() => {
    fileTracker.updateFileStatus();
  });

  vscode.workspace.onDidSaveTextDocument(() => {
    fileTracker.updateFileStatus();
  });

  // 初始化时更新文件状态
  fileTracker.updateFileStatus();
}

/**
 * 插件停用函数
 */
export function deactivate(): void {
  console.log('Changes Uploader 插件已停用');
}
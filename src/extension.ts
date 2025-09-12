import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import { promisify } from 'util';
import { FileTracker } from './fileTracker';
import { FileListProvider } from './fileListProvider';

// 将 child_process.exec 转换为 Promise 版本
const exec = promisify(childProcess.exec);

// 全局声明输出通道
let outputChannel: vscode.OutputChannel;

let loading = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Changes Uploader');
  outputChannel.appendLine('插件激活开始...');

  try {
    // 创建文件跟踪器实例
    const fileTracker = new FileTracker(context, outputChannel);

    // 创建文件列表提供者实例
    const fileListProvider = new FileListProvider(fileTracker, context, outputChannel);

    // 注册命令
    const commands = [
      vscode.commands.registerCommand('changes-uploader.uploadAllFiles', () => {
        fileListProvider.uploadAllFiles();
      }),

      vscode.commands.registerCommand('changes-uploader.uploadFile', (file) => {
        fileListProvider.uploadFile(file);
      }),

      vscode.commands.registerCommand('changes-uploader.removeFile', (file) => {
        fileListProvider.removeFile(file);
      }),

      vscode.commands.registerCommand('changes-uploader.deleteRemoteFile', (file) => {
        fileListProvider.deleteRemoteFile(file);
      }),

      vscode.commands.registerCommand('changes-uploader.refreshFileList', async () => {
        try {
          outputChannel.appendLine('正在刷新文件列表...');
          await fileTracker.updateFileStatus();
          fileListProvider.refresh('changes-uploader.refreshFileList');
          outputChannel.appendLine('文件列表刷新完成');
        } catch (error) {
          handleError('刷新文件列表失败', error);
        }
      }),
    ];

    // 将命令添加到订阅
    commands.forEach(cmd => context.subscriptions.push(cmd));

    // 注册侧边栏视图
    vscode.window.registerTreeDataProvider('changes-uploader.fileList', fileListProvider);

    // 创建树视图实例以便监听事件
    const treeView = vscode.window.createTreeView('changes-uploader.fileList', {
      treeDataProvider: fileListProvider
    });
    // 添加到上下文订阅
    // context.subscriptions.push(treeView);
    context.subscriptions.push(
      treeView.onDidChangeVisibility(e => {
        outputChannel.appendLine(`侧边栏可见性变化: ${e.visible}`);
        if (e.visible && !loading) {
          try {
            fileTracker.updateFileStatus();
            loading = true;
          } finally {
            loading = false;
          }
        }
      })
    );

    // 初始化文件状态
    fileTracker.updateFileStatus();
    fileListProvider.refresh('initialLoad');

    outputChannel.appendLine('插件激活成功');
    console.log('Changes Uploader 插件已激活');
  } catch (error) {
    handleError('插件激活失败', error);
  }
}

function handleError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  outputChannel.appendLine(`${context}: ${message}`);
  vscode.window.showErrorMessage(`${context}: ${message}`);
}

export function deactivate() {
  outputChannel.appendLine('插件已停用');
  outputChannel.dispose();
}
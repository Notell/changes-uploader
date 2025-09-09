import * as vscode from 'vscode';
import { FileTracker } from './fileTracker';
import { FileListProvider } from './fileListProvider';

// 创建输出通道
const outputChannel = vscode.window.createOutputChannel('Changes Uploader');

/**
 * 插件激活函数
 * @param context VS Code扩展上下文
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Changes Uploader 插件已激活');
  outputChannel.appendLine('Changes Uploader 插件已激活');

  // 创建文件跟踪器实例
  const fileTracker = new FileTracker(context, outputChannel);

  // 创建文件列表提供者实例
  const fileListProvider = new FileListProvider(fileTracker, context, outputChannel);

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
    }),
    
    vscode.commands.registerCommand('changes-uploader.refreshFileList', async () => {
      try {
        // 显示刷新状态通知
        vscode.window.showInformationMessage('正在刷新文件列表...');
        
        // 重新扫描Git状态
        await fileTracker.updateFileStatus();
        
        // 刷新树视图
        fileListProvider.refresh();
        
        // 显示刷新完成通知
        vscode.window.showInformationMessage('文件列表刷新完成');
      } catch (error) {
        console.error('刷新文件列表失败:', error);
        outputChannel.appendLine(`刷新文件列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
        vscode.window.showErrorMessage(`刷新文件列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
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

  // 添加测试命令，用于手动添加测试文件到跟踪列表
  context.subscriptions.push(
    vscode.commands.registerCommand('changes-uploader.addTestFile', () => {
      try {
        // 这里我们需要直接访问trackedFiles数组，但它是私有的
        // 所以我们需要一个临时的解决方法来测试视图功能
        
        // 显示提示信息
        vscode.window.showInformationMessage(
          'Changes Uploader: 请手动创建或修改文件以测试视图功能。\n' +
          '插件会自动跟踪Git仓库中修改的文件。' +
          '当前已找到 ' + fileTracker.getTrackedFiles().length + ' 个修改的文件'
        );
      } catch (error) {
        console.error('添加测试文件失败:', error);
        outputChannel.appendLine(`添加测试文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    })
  );

  // 注册测试命令到命令面板
  context.subscriptions.push(
    vscode.commands.registerCommand('changes-uploader.showDebugInfo', () => {
      const trackedFiles = fileTracker.getTrackedFiles();
      console.log('调试信息 - 跟踪的文件数量:', trackedFiles.length);
      outputChannel.appendLine(`调试信息 - 跟踪的文件数量: ${trackedFiles.length}`);
      console.log('跟踪的文件列表:', trackedFiles);
      outputChannel.appendLine(`跟踪的文件列表: ${JSON.stringify(trackedFiles.map(f => f.fileName))}`);
      
      vscode.window.showInformationMessage(
        '调试信息:\n' +
        `- 工作区文件夹数量: ${vscode.workspace.workspaceFolders?.length || 0}\n` +
        `- 跟踪的文件数量: ${trackedFiles.length}\n` +
        '- 视图是否已注册: 是'
      );
    })
  );
}

/**
 * 插件停用函数
 */
export function deactivate(): void {
  console.log('Changes Uploader 插件已停用');
  outputChannel.appendLine('Changes Uploader 插件已停用');
  outputChannel.dispose();
}
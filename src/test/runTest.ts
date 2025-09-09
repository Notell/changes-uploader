import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // 获取扩展测试目录路径
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // 运行VS Code测试
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions']
    });
  } catch (error) {
    console.error('测试运行失败');
    console.error(error);
    process.exit(1);
  }
}

main();
import * as path from 'path';
// 使用require导入Mocha，因为它不是ES模块
const mochaLib = require('mocha');
import * as glob from 'glob';

/**
 * 运行测试套件
 */
export function run(): Promise<void> {
  // 创建Mocha测试实例
  const mocha = new mochaLib({
    ui: 'tdd',
    color: true,
    timeout: 30000 // 30秒超时
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((c, e) => {
    try {
      // 查找所有测试文件
      const testFiles = glob.sync('**/**.test.js', {
        cwd: testsRoot
      });

      // 添加测试文件到Mocha
      testFiles.forEach((file: string) => {
        mocha.addFile(path.resolve(testsRoot, file));
      });

      // 运行测试
      mocha.run((failures: number) => {
        if (failures > 0) {
          e(new Error(`${failures} 个测试失败`));
        } else {
          c();
        }
      });
    } catch (error) {
      e(error);
    }
  });
}
/** @type {import('typedoc').TypeDocOptions} */
module.exports = {
  entryPoints: ['./src/index.ts'],
  // 文档同样走 release 配置，避免把 src 下的测试文件算进 program
  tsconfig: './tsconfig.release.json',
}

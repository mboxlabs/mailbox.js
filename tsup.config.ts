import { defineConfig } from 'tsup'

export default defineConfig({
  // 发包用 release 配置（排除 src 下的测试文件）；
  // 根目录 tsconfig.json 是编辑器/类型检查用的（含测试文件）。
  tsconfig: 'tsconfig.release.json',
  // 子路径 `./testing` 单独一个入口：测试基座不进主 bundle，也不出现在主入口的补全里。
  // `exports` 里那两个 dist/testing/* 能不能存在，全看这一行（`test/testing-subpath.test.ts` 钉住）。
  entry: ['src/index.ts', 'src/testing/index.ts'],
  format: ['cjs', 'esm'],
  // Inject cjs and esm shims:https://tsup.egoist.dev/#inject-cjs-and-esm-shims
  shims: true,
  // splitting: true,
  // sourcemap: true,
  // clean: true,
  minify: 'terser',
  terserOptions: {
    // compress: {
    //   drop_console: true,
    //   drop_debugger: true,
    // },
    // https://terser.org/docs/options/#mangle-options
    "mangle": {
      "properties": {
        "regex": /^_[$]/,
        // "undeclared": true, // Mangle those names when they are accessed as properties of known top level variables but their declarations are never found in input code.
      },
      "toplevel": true,
      "reserved": [
        // # expected names in web-extension content
        "WeakSet", "Set",
        // # expected names in 3rd-party extensions' contents
        "requestIdleCallback",
        // # content global names:
        "browser",
      ],
    }
  },
})

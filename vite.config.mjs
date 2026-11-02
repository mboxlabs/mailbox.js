import { defineConfig } from 'vite'

// 说明：这里不需要 vite-tsconfig-paths —— 项目没有 tsconfig paths 别名，
// 原来它指着的 tsconfig.spec.json 也已删除（类型检查统一用 tsconfig.json）。
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'test/*.spec.ts', 'test/*.test.ts'],
    testTimeout: 80000,
    globals: true,
    setupFiles: [
      './setupVitest.mjs',
    ],
  },
})

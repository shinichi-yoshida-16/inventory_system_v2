import { defineConfig } from 'vitest/config'

// server/utils配下はNitroの自動importに依存しているため、テスト実行前にtest/setup.tsで
// h3のユーティリティ関数・ApiErrorをglobalThisへ登録し、実行時に参照解決できるようにする。
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
})

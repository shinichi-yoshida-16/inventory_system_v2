// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  typescript: {
    strict: true,      // 厳格モード（推奨）
    typeCheck: true,   // ビルド時に型チェックを実行
  },
  runtimeConfig: {
    // 値はビルド時ではなくコンテナ起動時に NUXT_ プレフィックス付き環境変数（例: NUXT_GOOGLE_SERVICE_ACCOUNT_EMAIL）で上書きする。
    // process.env を直接読むとビルド時点の値が焼き込まれ、Cloud Run側の環境変数が反映されないため使わない。
    googleServiceAccountEmail: '',
    googlePrivateKey: '',
    googleSpreadsheetId: '',
    gcsBucket: '',
    gmailSender: '',
    gmailAppPassword: '',
  },
})

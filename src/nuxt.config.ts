// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  typescript: {
    strict: true,      // 厳格モード（推奨）
    typeCheck: true,   // ビルド時に型チェックを実行
  },
  runtimeConfig: {
    // .env の GOOGLE_* / GCS_ / GMAIL_ を読み込む（NUXT_ プレフィックスでも上書き可）
    googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
    googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY ?? '',
    googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID ?? '',
    gcsBucket: process.env.GCS_BUCKET ?? '',
    gmailSender: process.env.GMAIL_SENDER ?? '',
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD ?? '',
  },
})

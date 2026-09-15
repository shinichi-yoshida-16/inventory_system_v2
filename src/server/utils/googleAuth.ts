// サービスアカウント認証の共通化（sheets.ts / gcs.ts で共用）。
// コールドスタート短縮のため、全API同梱の googleapis ではなく google-auth-library を直接使う。
import { GoogleAuth } from 'google-auth-library'

/**
 * 秘密鍵の環境変数値を正規化する。
 * .envはdotenvが二重引用符とエスケープ(\n)を解釈するが、Cloud Run等の環境変数は
 * その解釈を行わないため、.envの値をそのままコピーすると前後に引用符が残ったり
 * \nがリテラルのまま残ったりして不正なPEMになる。ここで両方のケースを吸収する。
 */
function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim().replace(/^"([\s\S]*)"$/, '$1')
  return trimmed.replace(/\\n/g, '\n')
}

export function createGoogleAuth(scopes: string[]) {
  const config = useRuntimeConfig()
  return new GoogleAuth({
    credentials: {
      client_email: config.googleServiceAccountEmail,
      private_key: normalizePrivateKey(config.googlePrivateKey),
    },
    scopes,
  })
}

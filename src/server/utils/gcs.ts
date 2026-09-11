// データアクセス層: Cloud Storage（locks/ 排他ロック、pending/ 時差更新の蓄積データ、
// pending/alerts/ 通知マージ対象）の読み書き（overview.md 3.1 / 6.1 / 6.2）。
// verification/01_gcs_bucket.mjs で実証済みの googleapis の storage v1 クライアントをそのまま用いる
// （既に依存に含まれる googleapis を再利用し、@google-cloud/storage は追加しない）。
import { google, storage_v1 } from 'googleapis'

let storageClient: storage_v1.Storage | null = null

async function getStorageClient() {
  if (storageClient) return storageClient

  const config = useRuntimeConfig()
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: config.googleServiceAccountEmail,
      private_key: config.googlePrivateKey.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
  })

  storageClient = google.storage({ version: 'v1', auth })
  return storageClient
}

function getBucket(): string {
  const config = useRuntimeConfig()
  return config.gcsBucket
}

/** GCSのHTTPエラーからステータスコードを取り出す */
export function gcsErrorStatus(e: unknown): number | null {
  const err = e as { code?: number; response?: { status?: number } }
  return err.response?.status ?? err.code ?? null
}

/**
 * オブジェクトを新規作成する。ifGenerationMatchを指定すると条件付き作成（ロック用途）
 * @returns 作成できたら generation、既に存在（412）なら null
 */
export async function insertObject(
  name: string,
  body: unknown,
  ifGenerationMatch?: string | number
): Promise<string | null> {
  const storage = await getStorageClient()
  try {
    const res = await storage.objects.insert({
      bucket: getBucket(),
      name,
      uploadType: 'media',
      ifGenerationMatch: ifGenerationMatch !== undefined ? String(ifGenerationMatch) : undefined,
      requestBody: { name },
      media: { mimeType: 'application/json', body: JSON.stringify(body) },
    })
    return res.data.generation ?? null
  } catch (e) {
    if (gcsErrorStatus(e) === 412) return null
    throw e
  }
}

/**
 * オブジェクトをJSONとして読み出す（存在しなければnull）。
 * Content-Type: application/jsonで書き込んでいるためgaxiosが自動でJSONパースしたものが返る
 */
export async function getObjectJson<T>(name: string): Promise<T | null> {
  const storage = await getStorageClient()
  try {
    const res = await storage.objects.get({ bucket: getBucket(), object: name, alt: 'media' })
    return res.data as unknown as T
  } catch (e) {
    if (gcsErrorStatus(e) === 404) return null
    throw e
  }
}

/**
 * オブジェクトのメタデータ(generationのみ)を取得する（本文は読まない。存在しなければnull）
 */
export async function getObjectGeneration(name: string): Promise<string | null> {
  const storage = await getStorageClient()
  try {
    const res = await storage.objects.get({ bucket: getBucket(), object: name })
    return res.data.generation ?? null
  } catch (e) {
    if (gcsErrorStatus(e) === 404) return null
    throw e
  }
}

/**
 * オブジェクトを削除する。ifGenerationMatchが不一致（412）なら何もしない（falseを返す）
 */
export async function deleteObject(name: string, ifGenerationMatch?: string): Promise<boolean> {
  const storage = await getStorageClient()
  try {
    await storage.objects.delete({
      bucket: getBucket(),
      object: name,
      ifGenerationMatch,
    })
    return true
  } catch (e) {
    const status = gcsErrorStatus(e)
    if (status === 412 || status === 404) return false
    throw e
  }
}

/**
 * prefix配下のオブジェクト名一覧を取得する（デリミタ"/"で直下のみ。名前＝ISO8601順で時系列順）
 */
export async function listObjectNames(prefix: string, delimiter = '/'): Promise<string[]> {
  const storage = await getStorageClient()
  const names: string[] = []
  let pageToken: string | undefined
  do {
    const res = await storage.objects.list({
      bucket: getBucket(),
      prefix,
      delimiter,
      pageToken,
    })
    for (const item of res.data.items ?? []) {
      if (item.name) names.push(item.name)
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return names.sort()
}

// ロジック層: GCSオブジェクトロックの取得／解放（FR-14、overview.md 6.1 / sequence.md 2.3）。
// locks/inventory.lock を「スプレッドシート書き込み全般の直列化ロック」として扱う。
import { randomUUID } from 'crypto'

const LOCK_NAME = 'locks/inventory.lock'
const RETRY_INITIAL_MS = 200
const RETRY_MAX_MS = 1000
const TIMEOUT_MS = 8000
const STUCK_MS = 30000

interface LockBody {
  owner: string
  acquiredAt: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitter(ms: number): number {
  const delta = ms * 0.2
  return ms - delta + Math.random() * (delta * 2)
}

let ownerSeq = 0

/**
 * ロック取得を試みる（初回200ms、指数バックオフ×2、上限1s、±20%ジッタ、合計8秒でタイムアウト）。
 * 既存ロックが30秒超スタックしていれば、その時点のgenerationを条件に強制奪取する。
 * @returns 取得できたgenerationか、タイムアウトならnull
 */
export async function acquireLock(): Promise<string | null> {
  const owner = `pid${process.pid}-${randomUUID()}-${ownerSeq++}`
  const startedAt = Date.now()
  let waitMs = RETRY_INITIAL_MS

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const body: LockBody = { owner, acquiredAt: new Date().toISOString() }

    const generation = await insertObject(LOCK_NAME, body, 0)
    if (generation !== null) return generation

    // 412: 他者が保持中。スタックロック（30秒超）なら、読み取った時点のgenerationを条件に強制奪取する
    const current = await getObjectJson<LockBody>(LOCK_NAME)
    const currentGeneration = await getObjectGeneration(LOCK_NAME)
    if (current && currentGeneration && Date.now() - new Date(current.acquiredAt).getTime() > STUCK_MS) {
      const stolen = await insertObject(LOCK_NAME, body, currentGeneration)
      if (stolen !== null) return stolen
      // 他の待機者が先に奪取した場合は通常のリトライへ戻る
    }

    if (Date.now() - startedAt + waitMs >= TIMEOUT_MS) break
    await sleep(jitter(waitMs))
    waitMs = Math.min(waitMs * 2, RETRY_MAX_MS)
  }
  return null
}

/**
 * ロックを解放する（保持したgenerationが条件、412なら既に奪取済みなので何もしない）
 */
export async function releaseLock(generation: string): Promise<void> {
  await deleteObject(LOCK_NAME, generation)
}

/**
 * ロックを取得してfnを実行し、成功・失敗にかかわらずロックを解放する。
 * ロックが取得できなければ null を返す（呼び出し元がLOCK_TIMEOUTとして扱う）
 */
export async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const generation = await acquireLock()
  if (generation === null) return null
  try {
    return await fn()
  } finally {
    await releaseLock(generation)
  }
}

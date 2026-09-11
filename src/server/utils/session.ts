// ロジック層: セッション発行・検証・破棄（overview.md 6.3 / sequence.md 1章）。
// 実体は data/sessions.json（単一インスタンスのメモリ相当。再デプロイで消失＝全員再ログイン許容）。
import { randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

const SESSION_DIR = resolve('data')
const SESSION_FILE = resolve('data/sessions.json')
const SESSION_TTL_MS = 1000 * 60 * 30 // 30分（要件3-3）

interface Session {
  sessionId: string
  userId: string
  email: string
  expiresAt: string // UTC ISO8601
}

/**
 * JSONからのセッション情報読み込み
 */
export const readSessions = async (): Promise<Session[]> => {
  if (!existsSync(SESSION_FILE)) return []
  const raw = await readFile(SESSION_FILE, 'utf-8')
  return JSON.parse(raw) as Session[]
}

/**
 * JSONにセッション情報書き込み
 */
export const writeSessions = async (sessions: Session[]): Promise<void> => {
  if (!existsSync(SESSION_DIR)) {
    await mkdir(SESSION_DIR, { recursive: true })
  }
  await writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2), 'utf-8')
}

/**
 * セッション作成。期限切れの既存セッションは掃除してから追加する
 */
export const createSession = async (user: { allowId: string; email: string }): Promise<Session> => {
  const sessions = await readSessions()
  const now = new Date()
  const active = sessions.filter((s) => new Date(s.expiresAt) > now)

  const newSession: Session = {
    sessionId: randomUUID(),
    userId: user.allowId,
    email: user.email,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  }

  await writeSessions([...active, newSession])
  return newSession
}

/**
 * セッション検証。有効なら操作のたびに有効期限を+30分延長する（要件3-3）
 */
export const validateSession = async (sessionId: string): Promise<Session | null> => {
  const sessions = await readSessions()
  const index = sessions.findIndex((s) => s.sessionId === sessionId)
  if (index === -1) return null

  const session = sessions[index]!
  if (new Date(session.expiresAt) <= new Date()) {
    await writeSessions(sessions.filter((s) => s.sessionId !== sessionId))
    return null
  }

  const extended: Session = { ...session, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
  sessions[index] = extended
  await writeSessions(sessions)
  return extended
}

/**
 * セッション削除(ログアウト)
 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const sessions = await readSessions()
  await writeSessions(sessions.filter((s) => s.sessionId !== sessionId))
}

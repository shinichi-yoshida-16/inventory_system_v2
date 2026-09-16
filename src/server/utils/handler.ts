// API層共通: 成功/失敗レスポンスの整形（overview.md 4.1「{status:OK,data}」「{status:ERROR,code,message}」）。
import type { H3Event } from 'h3'

export function defineApi<T>(fn: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      const data = await fn(event)
      return { status: 'OK' as const, data: data ?? null }
    } catch (e) {
      const err =
        e instanceof ApiError ? e : new ApiError('INTERNAL_ERROR', 'サーバエラーが発生しました')
      if (!(e instanceof ApiError)) {
        console.error(e)
      }
      setResponseStatus(event, err.statusCode)
      return { status: 'ERROR' as const, code: err.code, message: err.message, ...(err.extra ?? {}) }
    }
  })
}

/**
 * x-session-idヘッダを検証し、操作者情報を解決する（overview.md 4.1）
 */
export async function requireSession(event: H3Event): Promise<{ allowId: string; email: string }> {
  const sessionId = getHeader(event, 'x-session-id')
  if (!sessionId) throw new ApiError('SESSION_INVALID', 'セッションIDがありません')

  const session = await validateSession(sessionId)
  if (!session) throw new ApiError('SESSION_INVALID', 'セッションが無効です')

  return { allowId: String(session.userId), email: session.email }
}

/**
 * セッション検証に加え、AllowListを再解決して管理者判定を行う（クライアントの申告は信用しない、4.1）
 */
export async function requireAdmin(
  event: H3Event
): Promise<{ allowId: string; email: string }> {
  const auth = await requireSession(event)
  const row = await findUserByEmail(auth.email)
  if (!row || !isAdminRow(row)) {
    throw new ApiError('PERMISSION_DENIED', '管理者権限が必要です')
  }
  return auth
}

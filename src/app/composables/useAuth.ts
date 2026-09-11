// 状態管理層: ログインユーザ・セッションIDの保持（overview.md 3.1、useState）。
// セッションはブラウザ再読込で失われる想定（外部ストア化しない、overview.md 6.3）。
interface AuthUser {
  email: string
  isAdmin: boolean
}

interface ApiEnvelope<T> {
  status: 'OK' | 'ERROR'
  data?: T
  code?: string
  message?: string
}

interface FetchErrorLike {
  data?: ApiEnvelope<unknown>
}

export const useAuth = () => {
  const user = useState<AuthUser | null>('auth:user', () => null)
  const sessionId = useState<string | null>('auth:sessionId', () => null)
  const { start, stop } = useLoading()
  const isLoggedIn = computed(() => user.value !== null && sessionId.value !== null)
  const isAdmin = computed(() => user.value?.isAdmin ?? false)

  const authHeaders = computed((): Record<string, string> => {
    if (!sessionId.value) return {}
    return { 'x-session-id': sessionId.value }
  })

  const clear = () => {
    user.value = null
    sessionId.value = null
  }

  /**
   * ログイン処理。失敗時はAPIのmessageをそのまま例外にして投げる
   */
  const login = async (email: string, password: string) => {
    start()
    try {
      const res = await $fetch<ApiEnvelope<{ sessionId: string; user: AuthUser }>>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      sessionId.value = res.data!.sessionId
      user.value = res.data!.user
    } catch (e) {
      const message = (e as FetchErrorLike)?.data?.message
      throw new Error(message || 'ログインに失敗しました')
    } finally {
      stop()
    }
  }

  /**
   * ログアウト処理
   */
  const logout = async () => {
    start()
    try {
      await $fetch('/api/auth/logout', { method: 'POST', headers: authHeaders.value })
    } finally {
      clear()
      stop()
    }
  }

  /**
   * サーバによるセッションの検証・復元（有効期限を延長する）
   */
  const restoreSession = async () => {
    if (!sessionId.value) return

    start()
    try {
      const res = await $fetch<ApiEnvelope<{ user: AuthUser }>>('/api/auth/user', {
        headers: authHeaders.value,
      })
      user.value = res.data!.user
    } catch {
      clear()
    } finally {
      stop()
    }
  }

  return { user, isLoggedIn, isAdmin, authHeaders, login, logout, restoreSession, clear }
}

// 状態管理層: 業務APIの共通呼び出し（x-session-id付与、{status,data}/{status,code,message}の展開）。
// $fetchは非2xx応答を例外として投げるため、e.data（サーバが返したERRORエンベロープ）から取り出す。
// SESSION_INVALIDを受けたら状態をクリアしD-00へ強制遷移する（overview.md 4.1/5章、transition.md 2章）。
interface ApiEnvelope<T> {
  status: 'OK' | 'ERROR'
  data?: T
  code?: string
  message?: string
}

interface FetchErrorLike {
  data?: ApiEnvelope<unknown> & { deferred?: boolean }
}

export interface ApiCallError extends Error {
  code?: string
  deferred?: boolean
}

export const useApi = () => {
  const { authHeaders, clear } = useAuth()
  const { start, stop } = useLoading()

  const apiFetch = async <T>(
    url: string,
    options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: Record<string, unknown> } = {}
  ): Promise<T> => {
    start()
    try {
      const res = await $fetch<ApiEnvelope<T>>(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: authHeaders.value,
      })
      return res.data as T
    } catch (e) {
      const envelope = (e as FetchErrorLike)?.data
      const code = envelope?.code
      const message = envelope?.message || 'エラーが発生しました'

      if (code === 'SESSION_INVALID') {
        clear()
        await navigateTo('/')
      }

      const err: ApiCallError = new Error(message)
      err.code = code
      err.deferred = envelope?.deferred === true
      throw err
    } finally {
      stop()
    }
  }

  return { apiFetch }
}

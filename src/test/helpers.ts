import type { H3Event } from 'h3'

/**
 * getRouterParam / getHeader / setResponseStatus が動作する最小限のH3Eventを組み立てる。
 * ルートハンドラの単体テスト専用（実際のHTTPサーバは起動しない）。
 */
export function createFakeEvent(opts: {
  params?: Record<string, string>
  headers?: Record<string, string>
} = {}): H3Event {
  return {
    context: { params: opts.params ?? {} },
    node: {
      req: { headers: opts.headers ?? {} },
      res: { statusCode: 200 },
    },
  } as unknown as H3Event
}

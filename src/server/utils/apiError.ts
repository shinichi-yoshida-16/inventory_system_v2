// API層共通: エラーコード体系（overview.md 4.1 / 5章）。
// ロジック層・API層はここで定義したApiErrorをthrowし、defineApi()（handler.ts）がレスポンス整形する。

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'SESSION_INVALID'
  | 'PERMISSION_DENIED'
  | 'INSUFFICIENT_STOCK'
  | 'LOCK_TIMEOUT'
  | 'SHEET_WRITE_FAILED'
  | 'ITEM_NOT_FOUND'
  | 'INTERNAL_ERROR'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  AUTH_FAILED: 401,
  SESSION_INVALID: 401,
  PERMISSION_DENIED: 403,
  INSUFFICIENT_STOCK: 400,
  LOCK_TIMEOUT: 409,
  SHEET_WRITE_FAILED: 502,
  ITEM_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
}

export class ApiError extends Error {
  code: ApiErrorCode
  statusCode: number
  extra?: Record<string, unknown>

  constructor(code: ApiErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.statusCode = STATUS_BY_CODE[code]
    this.extra = extra
  }
}

import { describe, it, expect } from 'vitest'
import { ApiError } from '../../server/utils/apiError'

describe('ApiError', () => {
  it('ITEM_NOT_FOUNDはHTTP 404にマッピングされる', () => {
    const err = new ApiError('ITEM_NOT_FOUND', '品目が見つかりません')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('ITEM_NOT_FOUND')
    expect(err.message).toBe('品目が見つかりません')
  })

  it('LOCK_TIMEOUTはHTTP 409、extraを保持する', () => {
    const err = new ApiError('LOCK_TIMEOUT', '時差更新として受け付けました', { deferred: true })
    expect(err.statusCode).toBe(409)
    expect(err.extra).toEqual({ deferred: true })
  })
})

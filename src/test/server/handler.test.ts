import { describe, it, expect, vi } from 'vitest'
import { createFakeEvent } from '../helpers'
import { defineApi, requireSession, requireAdmin } from '../../server/utils/handler'
import { ApiError } from '../../server/utils/apiError'

// isAdminRowはserver/utils/users.tsの実装(row.adminFlag参照)をそのまま模倣する
vi.stubGlobal('isAdminRow', (row: { adminFlag: boolean }) => row.adminFlag)

describe('defineApi', () => {
  it('成功時はstatus:OKでハンドラの戻り値をdataに詰める', async () => {
    const handler = defineApi(async () => ({ foo: 'bar' }))
    const event = createFakeEvent()

    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(200)
    expect(result).toEqual({ status: 'OK', data: { foo: 'bar' } })
  })

  it('戻り値がundefinedの場合はdata:nullを返す', async () => {
    const handler = defineApi(async () => undefined)
    const event = createFakeEvent()

    const result = await handler(event)

    expect(result).toEqual({ status: 'OK', data: null })
  })

  it('ApiErrorはそのコードに対応するHTTPステータスとcode/messageを返す', async () => {
    const handler = defineApi(async () => {
      throw new ApiError('ITEM_NOT_FOUND', '品目が見つかりません')
    })
    const event = createFakeEvent()

    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(404)
    expect(result).toEqual({ status: 'ERROR', code: 'ITEM_NOT_FOUND', message: '品目が見つかりません' })
  })

  it('ApiErrorのextraはレスポンスに展開される', async () => {
    const handler = defineApi(async () => {
      throw new ApiError('LOCK_TIMEOUT', '時差更新として受け付けました', { deferred: true })
    })
    const event = createFakeEvent()

    const result = await handler(event)

    expect(result).toEqual({
      status: 'ERROR',
      code: 'LOCK_TIMEOUT',
      message: '時差更新として受け付けました',
      deferred: true,
    })
  })

  it('ApiError以外の例外はINTERNAL_ERROR(500)としてログ出力しつつ返す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = defineApi(async () => {
      throw new Error('想定外のエラー')
    })
    const event = createFakeEvent()

    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(500)
    expect(result).toEqual({ status: 'ERROR', code: 'INTERNAL_ERROR', message: 'サーバエラーが発生しました' })
    expect(consoleError).toHaveBeenCalledWith(expect.any(Error))
    consoleError.mockRestore()
  })
})

describe('requireSession', () => {
  it('x-session-idヘッダがなければSESSION_INVALIDを投げる', async () => {
    const event = createFakeEvent()

    await expect(requireSession(event)).rejects.toMatchObject({
      code: 'SESSION_INVALID',
      statusCode: 401,
    })
  })

  it('セッションが無効(null)ならSESSION_INVALIDを投げる', async () => {
    vi.stubGlobal('validateSession', vi.fn().mockResolvedValue(null))
    const event = createFakeEvent({ headers: { 'x-session-id': 'sess-1' } })

    await expect(requireSession(event)).rejects.toMatchObject({ code: 'SESSION_INVALID' })
  })

  it('セッションが有効なら operator 情報を返す', async () => {
    vi.stubGlobal(
      'validateSession',
      vi.fn().mockResolvedValue({ userId: '42', email: 'user@example.com' })
    )
    const event = createFakeEvent({ headers: { 'x-session-id': 'sess-1' } })

    await expect(requireSession(event)).resolves.toEqual({ allowId: '42', email: 'user@example.com' })
  })
})

describe('requireAdmin', () => {
  it('セッションが無効ならrequireSessionの例外をそのまま伝播する', async () => {
    const event = createFakeEvent()

    await expect(requireAdmin(event)).rejects.toMatchObject({ code: 'SESSION_INVALID' })
  })

  it('管理者フラグを持たないユーザーはPERMISSION_DENIEDになる', async () => {
    vi.stubGlobal(
      'validateSession',
      vi.fn().mockResolvedValue({ userId: '1', email: 'user@example.com' })
    )
    vi.stubGlobal('findUserByEmail', vi.fn().mockResolvedValue({ adminFlag: false }))
    const event = createFakeEvent({ headers: { 'x-session-id': 'sess-1' } })

    await expect(requireAdmin(event)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      statusCode: 403,
    })
  })

  it('AllowListに見つからないユーザーもPERMISSION_DENIEDになる', async () => {
    vi.stubGlobal(
      'validateSession',
      vi.fn().mockResolvedValue({ userId: '1', email: 'ghost@example.com' })
    )
    vi.stubGlobal('findUserByEmail', vi.fn().mockResolvedValue(null))
    const event = createFakeEvent({ headers: { 'x-session-id': 'sess-1' } })

    await expect(requireAdmin(event)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('管理者フラグを持つユーザーはoperator情報を返す', async () => {
    vi.stubGlobal(
      'validateSession',
      vi.fn().mockResolvedValue({ userId: '1', email: 'admin@example.com' })
    )
    vi.stubGlobal('findUserByEmail', vi.fn().mockResolvedValue({ adminFlag: true }))
    const event = createFakeEvent({ headers: { 'x-session-id': 'sess-1' } })

    await expect(requireAdmin(event)).resolves.toEqual({ allowId: '1', email: 'admin@example.com' })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createFakeEvent } from '../helpers'
import type { InventoryRow } from '../../server/utils/sheets'

const sampleRow: InventoryRow = {
  itemId: 'ITM-000001',
  gtin: '04901234567894',
  itemName: 'テスト部品',
  currentStock: 3,
  threshold: 1,
  alertSentFlag: false,
  location: '棚A',
  discontinuedFlag: false,
  updatedAt: '2026-09-15T00:00:00.000Z',
}

// exists.get.ts はモジュール評価時に defineApi(...) を呼ぶため、
// 各テストでの動的importより前にfindItemByIdOrGtin等のglobalを用意しておく必要がある。
async function loadHandler() {
  const mod = await import('../../server/api/inventory/[itemId]/exists.get.ts')
  return mod.default
}

describe('GET /api/inventory/{itemId}/exists', () => {
  it('未登録品目でもHTTP 404にはならずexists:falseを返す', async () => {
    vi.stubGlobal('findItemByIdOrGtin', vi.fn().mockResolvedValue(null))
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: 'ITM-999999' } })
    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(200)
    expect(result).toEqual({ status: 'OK', data: { exists: false } })
  })

  it('登録済み品目はexists:trueと品目情報を返す', async () => {
    vi.stubGlobal('findItemByIdOrGtin', vi.fn().mockResolvedValue(sampleRow))
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: 'ITM-000001' } })
    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(200)
    expect(result).toEqual({
      status: 'OK',
      data: { exists: true, itemId: 'ITM-000001', itemName: 'テスト部品', currentStock: 3 },
    })
  })

  it('GTIN(14桁)でも問い合わせできる', async () => {
    const findItemByIdOrGtin = vi.fn().mockResolvedValue(sampleRow)
    vi.stubGlobal('findItemByIdOrGtin', findItemByIdOrGtin)
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: '04901234567894' } })
    await handler(event)

    expect(findItemByIdOrGtin).toHaveBeenCalledWith('04901234567894')
  })

  it('itemId/GTINどちらの形式にも合わない値はINVALID_INPUT(400)', async () => {
    vi.stubGlobal('findItemByIdOrGtin', vi.fn())
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: 'not-a-valid-code' } })
    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(400)
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_INPUT' })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createFakeEvent } from '../helpers'
import { getItemByIdOrGtin } from '../../server/utils/inventory'
import type { InventoryRow } from '../../server/utils/sheets'

// index.get.ts はgetItemByIdOrGtinをNitroの自動importで参照しているため、実体をglobalへ登録する
vi.stubGlobal('getItemByIdOrGtin', getItemByIdOrGtin)

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

async function loadHandler() {
  const mod = await import('../../server/api/inventory/[itemId]/index.get.ts')
  return mod.default
}

// exists.get.ts追加後もGET /api/inventory/{itemId}自体は従来どおりITEM_NOT_FOUND(404)を返すことの回帰確認
describe('GET /api/inventory/{itemId}', () => {
  it('登録済み品目は品目情報を返す', async () => {
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: 'ITM-000001' } })
    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(200)
    expect(result).toEqual({ status: 'OK', data: sampleRow })
  })

  it('未登録品目はHTTP 404・ITEM_NOT_FOUNDを返す', async () => {
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: 'ITM-999999' } })
    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(404)
    expect(result).toMatchObject({ status: 'ERROR', code: 'ITEM_NOT_FOUND' })
  })

  it('itemId/GTINどちらの形式にも合わない値はINVALID_INPUT(400)', async () => {
    vi.stubGlobal('findInventoryRowIndex', vi.fn())
    const handler = await loadHandler()

    const event = createFakeEvent({ params: { itemId: 'not-a-valid-code' } })
    const result = await handler(event)

    expect(event.node.res.statusCode).toBe(400)
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_INPUT' })
  })
})

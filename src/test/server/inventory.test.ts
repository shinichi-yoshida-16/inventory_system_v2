import { describe, it, expect, vi } from 'vitest'
import { findItemByIdOrGtin, getItemByIdOrGtin } from '../../server/utils/inventory'
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

describe('findItemByIdOrGtin', () => {
  it('品目が見つかれば行データを返す', async () => {
    vi.stubGlobal(
      'findInventoryRowIndex',
      vi.fn().mockResolvedValue({ row: sampleRow, index: 0 })
    )

    await expect(findItemByIdOrGtin('ITM-000001')).resolves.toEqual(sampleRow)
  })

  it('品目が見つからなければ例外を投げずnullを返す', async () => {
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))

    await expect(findItemByIdOrGtin('ITM-999999')).resolves.toBeNull()
  })
})

describe('getItemByIdOrGtin', () => {
  it('品目が見つかれば行データを返す', async () => {
    vi.stubGlobal(
      'findInventoryRowIndex',
      vi.fn().mockResolvedValue({ row: sampleRow, index: 0 })
    )

    await expect(getItemByIdOrGtin('ITM-000001')).resolves.toEqual(sampleRow)
  })

  it('品目が見つからなければITEM_NOT_FOUNDを投げる', async () => {
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))

    await expect(getItemByIdOrGtin('ITM-999999')).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
      statusCode: 404,
    })
  })
})

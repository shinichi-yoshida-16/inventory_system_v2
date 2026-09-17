import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  scan,
  updateThresholds,
  updateDiscontinued,
  listInventory,
  formatItemId,
} from '../../server/utils/inventory'
import type { InventoryRow } from '../../server/utils/sheets'

const sampleRow: InventoryRow = {
  itemId: 'ITM-000001',
  gtin: '04901234567894',
  itemName: 'テスト部品',
  currentStock: 3,
  threshold: 5,
  alertSentFlag: false,
  location: '棚A',
  discontinuedFlag: false,
  updatedAt: '2026-09-15T00:00:00.000Z',
}

/** withLockはテスト対象のコールバックをそのまま実行する（実ロックを模倣） */
function stubLockSucceeds() {
  vi.stubGlobal('withLock', vi.fn().mockImplementation((fn: () => unknown) => fn()))
}

function stubLockTimesOut() {
  vi.stubGlobal('withLock', vi.fn().mockResolvedValue(null))
}

beforeEach(() => {
  vi.stubGlobal('appendTransaction', vi.fn().mockResolvedValue(undefined))
  vi.stubGlobal('getMaxTransactionId', vi.fn().mockResolvedValue(10))
  vi.stubGlobal('deleteObject', vi.fn().mockResolvedValue(true))
  vi.stubGlobal('insertObject', vi.fn().mockResolvedValue(undefined))
  vi.stubGlobal('sendAlertForItem', vi.fn().mockResolvedValue(undefined))
})

describe('listInventory', () => {
  it('getInventoryRowsの結果をそのまま返す', async () => {
    vi.stubGlobal('getInventoryRows', vi.fn().mockResolvedValue([sampleRow]))

    await expect(listInventory()).resolves.toEqual([sampleRow])
  })
})

describe('scan - 新規登録（itemId未指定）', () => {
  it('未登録GTINなら次の連番でITM-採番し入庫1で登録する', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('getMaxItemIdSeq', vi.fn().mockResolvedValue(41))
    const appendInventoryRow = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('appendInventoryRow', appendInventoryRow)

    const result = await scan({
      gtin: '04901234567894',
      itemName: '新規部品',
      threshold: 2,
      type: 'IN',
      quantity: 1,
      operator: 'user@example.com',
    })

    expect(result).toEqual({ itemId: formatItemId(42), currentStock: 1 })
    expect(appendInventoryRow).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'ITM-000042', gtin: '04901234567894', currentStock: 1 })
    )
  })

  it('既に登録済みのGTINならINVALID_INPUTを投げる', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))

    await expect(
      scan({ gtin: sampleRow.gtin, type: 'IN', quantity: 1, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('書き込み失敗時はSHEET_WRITE_FAILEDを投げる', async () => {
    stubLockSucceeds()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))
    vi.stubGlobal('getMaxItemIdSeq', vi.fn().mockResolvedValue(0))
    vi.stubGlobal('appendInventoryRow', vi.fn().mockRejectedValue(new Error('sheets down')))

    await expect(
      scan({ type: 'IN', quantity: 1, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'SHEET_WRITE_FAILED' })

    consoleError.mockRestore()
  })

  it('ロック取得に失敗した場合は時差更新の対象外としてLOCK_TIMEOUTを投げる', async () => {
    stubLockTimesOut()

    await expect(
      scan({ type: 'IN', quantity: 1, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
  })
})

describe('scan - 既存品目の入出庫（itemId指定）', () => {
  it('出庫数が在庫を超える場合はINSUFFICIENT_STOCKを投げる', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))

    await expect(
      scan({ itemId: sampleRow.itemId, type: 'OUT', quantity: 99, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' })
  })

  it('itemIdが未登録ならITEM_NOT_FOUNDを投げる', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))

    await expect(
      scan({ itemId: 'ITM-999999', type: 'OUT', quantity: 1, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })
  })

  it('出庫後に在庫が閾値を下回ればアラート未送信時のみ通知を送る', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))
    vi.stubGlobal('updateInventoryRow', vi.fn().mockResolvedValue(undefined))
    const sendAlertForItem = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('sendAlertForItem', sendAlertForItem)

    const result = await scan({
      itemId: sampleRow.itemId,
      type: 'OUT',
      quantity: 1,
      operator: 'user@example.com',
    })

    expect(result).toEqual({ itemId: sampleRow.itemId, currentStock: 2 })
    expect(sendAlertForItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: sampleRow.itemId, currentStock: 2, threshold: sampleRow.threshold })
    )
  })

  it('出庫後もアラート送信済みなら再送しない', async () => {
    stubLockSucceeds()
    const alreadyAlerted = { ...sampleRow, alertSentFlag: true }
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: alreadyAlerted, index: 0 }))
    vi.stubGlobal('updateInventoryRow', vi.fn().mockResolvedValue(undefined))
    const sendAlertForItem = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('sendAlertForItem', sendAlertForItem)

    await scan({ itemId: alreadyAlerted.itemId, type: 'OUT', quantity: 1, operator: 'user@example.com' })

    expect(sendAlertForItem).not.toHaveBeenCalled()
  })

  it('入庫で閾値以上に回復しアラート送信済みなら、フラグを解除し退避オブジェクトを削除する', async () => {
    stubLockSucceeds()
    const alreadyAlerted = { ...sampleRow, currentStock: 1, threshold: 5, alertSentFlag: true }
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: alreadyAlerted, index: 0 }))
    const updateInventoryRow = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('updateInventoryRow', updateInventoryRow)
    const deleteObject = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('deleteObject', deleteObject)

    const result = await scan({
      itemId: alreadyAlerted.itemId,
      type: 'IN',
      quantity: 10,
      operator: 'user@example.com',
    })

    expect(result.currentStock).toBe(11)
    expect(updateInventoryRow).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ alertSentFlag: false })
    )
    expect(deleteObject).toHaveBeenCalledWith(`pending/alerts/${alreadyAlerted.itemId}.json`)
  })

  it('書き込み失敗時は蓄積データへ退避しSHEET_WRITE_FAILED(deferred)を投げる', async () => {
    stubLockSucceeds()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))
    vi.stubGlobal('updateInventoryRow', vi.fn().mockRejectedValue(new Error('sheets down')))
    const insertObject = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('insertObject', insertObject)

    await expect(
      scan({ itemId: sampleRow.itemId, type: 'OUT', quantity: 1, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'SHEET_WRITE_FAILED', extra: { deferred: true } })

    expect(insertObject).toHaveBeenCalledWith(
      expect.stringMatching(/^pending\//),
      expect.objectContaining({ itemId: sampleRow.itemId, type: 'OUT', quantity: 1 })
    )
    consoleError.mockRestore()
  })

  it('ロック取得に失敗した場合は蓄積データへ退避しLOCK_TIMEOUT(deferred)を投げる', async () => {
    stubLockTimesOut()
    const insertObject = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('insertObject', insertObject)

    await expect(
      scan({ itemId: sampleRow.itemId, type: 'IN', quantity: 1, operator: 'user@example.com' })
    ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT', extra: { deferred: true } })

    expect(insertObject).toHaveBeenCalled()
  })
})

describe('updateThresholds', () => {
  it('全品目の閾値を一括更新し件数を返す', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))
    const batchUpdateInventoryRows = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('batchUpdateInventoryRows', batchUpdateInventoryRows)

    const count = await updateThresholds([{ itemId: sampleRow.itemId, threshold: 10 }])

    expect(count).toBe(1)
    expect(batchUpdateInventoryRows).toHaveBeenCalledWith([
      { index: 0, item: expect.objectContaining({ threshold: 10 }) },
    ])
  })

  it('存在しない品目が含まれる場合はINVALID_INPUTを投げる', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))

    await expect(updateThresholds([{ itemId: 'ITM-999999', threshold: 1 }])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('ロック取得に失敗した場合はLOCK_TIMEOUTを投げる', async () => {
    stubLockTimesOut()

    await expect(updateThresholds([{ itemId: sampleRow.itemId, threshold: 1 }])).rejects.toMatchObject({
      code: 'LOCK_TIMEOUT',
    })
  })
})

describe('updateDiscontinued', () => {
  it('廃番フラグを更新する', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue({ row: sampleRow, index: 0 }))
    const updateInventoryRow = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('updateInventoryRow', updateInventoryRow)

    await updateDiscontinued(sampleRow.itemId, true)

    expect(updateInventoryRow).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ discontinuedFlag: true })
    )
  })

  it('存在しない品目の場合はITEM_NOT_FOUNDを投げる', async () => {
    stubLockSucceeds()
    vi.stubGlobal('findInventoryRowIndex', vi.fn().mockResolvedValue(null))

    await expect(updateDiscontinued('ITM-999999', true)).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    })
  })

  it('ロック取得に失敗した場合はLOCK_TIMEOUTを投げる', async () => {
    stubLockTimesOut()

    await expect(updateDiscontinued(sampleRow.itemId, true)).rejects.toMatchObject({
      code: 'LOCK_TIMEOUT',
    })
  })
})

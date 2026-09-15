// ロジック層: 在庫増減、閾値判定、アラート送信要否、ITM-採番（FR-06/FR-07/FR-08/FR-11/FR-12）。
// database.md 冒頭の採番規則、overview.md 4.1〜4.6・5章・6.1、sequence.md 2.1/2.2/2.5 に対応する。
import { randomUUID } from 'crypto'
import type { InventoryRow } from './sheets'

export const ITEM_ID_RE = /^ITM-\d{6}$/
export const GTIN_RE = /^\d{14}$/

export function formatItemId(seq: number): string {
  return `ITM-${String(seq).padStart(6, '0')}`
}

export function formatTargetId(seq: number): string {
  return `TAR-${String(seq).padStart(3, '0')}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export interface ScanParams {
  itemId?: string
  gtin?: string
  type: 'IN' | 'OUT'
  quantity: number
  itemName?: string
  threshold?: number
  location?: string
  operator: string
}

export interface ScanResult {
  itemId: string
  currentStock: number
}

/**
 * 在庫一覧を取得する（FR-02）
 */
export async function listInventory(): Promise<InventoryRow[]> {
  return getInventoryRows()
}

/**
 * itemId列 → gtin列 の順で品目を検索する。未登録ならnullを返す（存在確認用、404を伴わない）
 */
export async function findItemByIdOrGtin(value: string): Promise<InventoryRow | null> {
  const found = await findInventoryRowIndex(value)
  return found ? found.row : null
}

/**
 * itemId列 → gtin列 の順で品目を検索する。未登録ならITEM_NOT_FOUNDを投げる（FR-05）
 */
export async function getItemByIdOrGtin(value: string): Promise<InventoryRow> {
  const row = await findItemByIdOrGtin(value)
  if (!row) throw new ApiError('ITEM_NOT_FOUND', '品目が見つかりません')
  return row
}

/**
 * 在庫スキャン処理（入庫/出庫/未登録品目の自動登録）を行う。sequence.md 2.1/2.2/2.5。
 */
export async function scan(params: ScanParams): Promise<ScanResult> {
  const isNewRegistration = !params.itemId

  if (isNewRegistration) {
    return await registerAndStockIn(params)
  }
  return await updateExistingStock(params)
}

async function registerAndStockIn(params: ScanParams): Promise<ScanResult> {
  const result = await withLock(async () => {
    if (params.gtin) {
      const existing = await findInventoryRowIndex(params.gtin)
      if (existing) {
        throw new ApiError('INVALID_INPUT', 'すでに登録されている品目です。読み取り直してください')
      }
    }

    const nextSeq = (await getMaxItemIdSeq()) + 1
    const itemId = formatItemId(nextSeq)
    const operationId = randomUUID()
    const now = nowIso()

    try {
      await appendTransaction({
        transactionId: (await getMaxTransactionId()) + 1,
        transactionAt: now,
        itemId,
        type: 'IN',
        quantity: 1,
        userEmail: params.operator,
        operationId,
      })
      await appendInventoryRow({
        itemId,
        gtin: params.gtin ?? '',
        itemName: params.itemName ?? '',
        currentStock: 1,
        threshold: params.threshold ?? 0,
        alertSentFlag: false,
        location: params.location ?? '',
        discontinuedFlag: false,
        updatedAt: now,
      })
    } catch (e) {
      if (e instanceof ApiError) throw e
      console.error(e)
      throw new ApiError('SHEET_WRITE_FAILED', '登録に失敗しました。再実行してください')
    }

    return { itemId, currentStock: 1 }
  })

  if (result === null) {
    // 新規登録は時差更新の対象外（蓄積データのスキーマが品目名等を保持できないため）
    throw new ApiError('LOCK_TIMEOUT', '排他ロックを取得できませんでした。再実行してください')
  }
  return result
}

async function updateExistingStock(params: ScanParams): Promise<ScanResult> {
  const itemId = params.itemId!
  const operationId = randomUUID()
  const occurredAt = nowIso()

  let alertItem: { itemId: string; itemName: string; threshold: number; currentStock: number } | null = null

  const result = await withLock(async () => {
    const found = await findInventoryRowIndex(itemId)
    if (!found) throw new ApiError('ITEM_NOT_FOUND', '品目が見つかりません')
    const { row, index } = found

    let newStock: number
    if (params.type === 'OUT') {
      if (params.quantity > row.currentStock) {
        throw new ApiError('INSUFFICIENT_STOCK', '在庫が不足しています')
      }
      newStock = row.currentStock - params.quantity
    } else {
      newStock = row.currentStock + params.quantity
    }

    const wasAlertSent = row.alertSentFlag
    const updatedRow: InventoryRow = { ...row, currentStock: newStock, updatedAt: occurredAt }

    if (params.type === 'IN' && newStock >= row.threshold && wasAlertSent) {
      updatedRow.alertSentFlag = false
    }

    try {
      await appendTransaction({
        transactionId: (await getMaxTransactionId()) + 1,
        transactionAt: occurredAt,
        itemId,
        type: params.type,
        quantity: params.quantity,
        userEmail: params.operator,
        operationId,
      })
      await updateInventoryRow(index, updatedRow)
    } catch (e) {
      if (e instanceof ApiError) throw e
      console.error(e)
      // 書き込み失敗は蓄積データへ退避し時差更新対象とする（operationIdで冪等に後追い適用、overview.md 5章）
      await stashPendingOperation({
        operationId,
        itemId,
        type: params.type,
        quantity: params.quantity,
        operator: params.operator,
        occurredAt,
      })
      throw new ApiError('SHEET_WRITE_FAILED', '時差更新として受け付けました', { deferred: true })
    }

    if (params.type === 'IN' && updatedRow.alertSentFlag === false && wasAlertSent) {
      await deleteObject(`pending/alerts/${itemId}.json`).catch(() => undefined)
    }

    if (params.type === 'OUT' && newStock < row.threshold && !wasAlertSent) {
      alertItem = { itemId, itemName: row.itemName, threshold: row.threshold, currentStock: newStock }
    }

    return { itemId, currentStock: newStock }
  })

  if (result === null) {
    // 入出庫はロック取得不可でも時差更新として受け付ける(FR-14/FR-15)
    await stashPendingOperation({ operationId, itemId, type: params.type, quantity: params.quantity, operator: params.operator, occurredAt })
    throw new ApiError('LOCK_TIMEOUT', '時差更新として受け付けました', { deferred: true })
  }

  if (alertItem) {
    // ロック解放後の独立系（overview.md 4.4）。失敗しても在庫更新自体の成功には影響させない
    await sendAlertForItem(alertItem).catch((e) => console.error(e))
  }

  return result
}

/**
 * ロック取得失敗・書き込み失敗時に入出庫を蓄積データへ退避する（overview.md 6.2）
 */
async function stashPendingOperation(op: {
  operationId: string
  itemId: string
  type: 'IN' | 'OUT'
  quantity: number
  operator: string
  occurredAt: string
}): Promise<void> {
  const name = `pending/${new Date().toISOString()}-${randomUUID().slice(0, 8)}.json`
  await insertObject(name, op)
}

export interface ThresholdUpdateItem {
  itemId: string
  threshold: number
}

/**
 * 閾値の一括更新（管理者のみ、FR-08）。ロックを取得できなければLOCK_TIMEOUT（時差更新の対象外）
 */
export async function updateThresholds(items: ThresholdUpdateItem[]): Promise<number> {
  const result = await withLock(async () => {
    const now = nowIso()
    const updates: { index: number; item: InventoryRow }[] = []
    for (const item of items) {
      const found = await findInventoryRowIndex(item.itemId)
      if (!found) throw new ApiError('INVALID_INPUT', `品目が見つかりません: ${item.itemId}`)
      updates.push({ index: found.index, item: { ...found.row, threshold: item.threshold, updatedAt: now } })
    }
    await batchUpdateInventoryRows(updates)
    return items.length
  })

  if (result === null) {
    throw new ApiError('LOCK_TIMEOUT', '排他ロックを取得できませんでした。再実行してください')
  }
  return result
}

/**
 * 廃番フラグの更新（管理者のみ、FR-11）
 */
export async function updateDiscontinued(itemId: string, discontinued: boolean): Promise<void> {
  const result = await withLock(async () => {
    const found = await findInventoryRowIndex(itemId)
    if (!found) throw new ApiError('ITEM_NOT_FOUND', '品目が見つかりません')
    await updateInventoryRow(found.index, { ...found.row, discontinuedFlag: discontinued, updatedAt: nowIso() })
    return true
  })

  if (result === null) {
    throw new ApiError('LOCK_TIMEOUT', '排他ロックを取得できませんでした。再実行してください')
  }
}

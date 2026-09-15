// データアクセス層: Googleスプレッドシートの読み書き（overview.md 3.1 / database.md）。
// ロジック層・API層はここを経由し、直接 googleapis を呼ばない。
// コールドスタート短縮のため、全API同梱の googleapis ではなく Sheets単体の @googleapis/sheets を使う。
import { sheets, sheets_v4 } from '@googleapis/sheets'
import { createGoogleAuth } from './googleAuth'

export interface InventoryRow {
  itemId: string
  gtin: string
  itemName: string
  currentStock: number
  threshold: number
  alertSentFlag: boolean
  location: string
  discontinuedFlag: boolean
  updatedAt: string
}

export interface TransactionRow {
  transactionId: number
  transactionAt: string
  itemId: string
  type: 'IN' | 'OUT'
  quantity: number
  userEmail: string
  operationId: string
}

export interface NotificationTargetRow {
  targetId: string
  email: string
  updatedAt: string
}

export interface AllowListRow {
  allowId: string
  email: string
  passwordHash: string
  targetId: string
  retiredFlag: boolean
  updatedAt: string
}

const INVENTORY_RANGE = 'InventoryMaster!A2:I'
const TRANSACTION_RANGE = 'TransactionLog!A2:G'
const TRANSACTION_APPEND_RANGE = 'TransactionLog!A:G'
const NOTIFICATION_RANGE = 'NotificationTargets!A2:C'
const NOTIFICATION_APPEND_RANGE = 'NotificationTargets!A:C'
const ALLOWLIST_RANGE = 'AllowList!A2:F'

let sheetsClient: sheets_v4.Sheets | null = null

/**
 * Sheets APIクライアントを取得する（SA認証情報はruntimeConfig経由）
 */
export async function getSheetsClient() {
  if (sheetsClient) return sheetsClient

  const auth = createGoogleAuth(['https://www.googleapis.com/auth/spreadsheets'])
  sheetsClient = sheets({ version: 'v4', auth })
  return sheetsClient
}

function toBool(v: unknown): boolean {
  return String(v).toUpperCase() === 'TRUE'
}
function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function inventoryFromRow(row: unknown[]): InventoryRow {
  return {
    itemId: String(row[0] ?? ''),
    gtin: String(row[1] ?? ''),
    itemName: String(row[2] ?? ''),
    currentStock: toNum(row[3]),
    threshold: toNum(row[4]),
    alertSentFlag: toBool(row[5]),
    location: String(row[6] ?? ''),
    discontinuedFlag: toBool(row[7]),
    updatedAt: String(row[8] ?? ''),
  }
}

function inventoryToRow(item: InventoryRow): unknown[] {
  return [
    item.itemId,
    item.gtin,
    item.itemName,
    item.currentStock,
    item.threshold,
    item.alertSentFlag,
    item.location,
    item.discontinuedFlag,
    item.updatedAt,
  ]
}

// --- 在庫マスタ(InventoryMaster) ---
// 6.7: 短TTLキャッシュ（数秒）。ロック区間内での更新後は invalidateInventoryCache() で無効化する。
let inventoryCache: { rows: InventoryRow[]; expiresAt: number } | null = null
const INVENTORY_CACHE_TTL_MS = 3000

export function invalidateInventoryCache(): void {
  inventoryCache = null
}

/**
 * 在庫マスタ全行を取得する（短TTLキャッシュあり、6.7）
 */
export async function getInventoryRows(): Promise<InventoryRow[]> {
  if (inventoryCache && inventoryCache.expiresAt > Date.now()) {
    return inventoryCache.rows
  }
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: INVENTORY_RANGE,
  })
  const rows = (res.data.values || []).map(inventoryFromRow)
  inventoryCache = { rows, expiresAt: Date.now() + INVENTORY_CACHE_TTL_MS }
  return rows
}

/**
 * itemId列 → gtin列 の順で品目を検索する（6.7、行番号は0始まり＝InventoryMasterのA2からの相対）
 */
export async function findInventoryRowIndex(idOrGtin: string): Promise<{ row: InventoryRow; index: number } | null> {
  const rows = await getInventoryRows()
  let index = rows.findIndex((r) => r.itemId === idOrGtin)
  if (index === -1) index = rows.findIndex((r) => r.gtin !== '' && r.gtin === idOrGtin)
  if (index === -1) return null
  return { row: rows[index]!, index }
}

/**
 * ITM- の最大連番を取得する（新規採番用。呼び出し元がロック区間内で使うこと）
 */
export async function getMaxItemIdSeq(): Promise<number> {
  const rows = await getInventoryRows()
  let max = 0
  for (const r of rows) {
    const m = /^ITM-(\d{6})$/.exec(r.itemId)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * 在庫マスタへ新規行を追加する（呼び出し元がロック区間内で使うこと。キャッシュを無効化する）
 */
export async function appendInventoryRow(item: InventoryRow): Promise<void> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSpreadsheetId,
    range: 'InventoryMaster!A:I',
    valueInputOption: 'RAW',
    requestBody: { values: [inventoryToRow(item)] },
  })
  invalidateInventoryCache()
}

/**
 * 在庫マスタの既存行を更新する（rowIndexはA2起点の0始まり）
 */
export async function updateInventoryRow(rowIndex: number, item: InventoryRow): Promise<void> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const sheetRow = rowIndex + 2
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSpreadsheetId,
    range: `InventoryMaster!A${sheetRow}:I${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [inventoryToRow(item)] },
  })
  invalidateInventoryCache()
}

/**
 * 在庫マスタの複数行を1回のbatchUpdateで更新する（6.7「複数行一括更新を1リクエストにまとめる」）
 */
export async function batchUpdateInventoryRows(updates: { index: number; item: InventoryRow }[]): Promise<void> {
  if (updates.length === 0) return
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.googleSpreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map(({ index, item }) => ({
        range: `InventoryMaster!A${index + 2}:I${index + 2}`,
        values: [inventoryToRow(item)],
      })),
    },
  })
  invalidateInventoryCache()
}

// --- 入出庫履歴(TransactionLog) ---

/**
 * TransactionLogのA列最大値+1（transactionIdの採番。呼び出し元がロック区間内で使うこと）
 */
export async function getMaxTransactionId(): Promise<number> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: 'TransactionLog!A2:A',
  })
  const values = res.data.values || []
  let max = 0
  for (const row of values) {
    const n = Number(row[0])
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return max
}

/**
 * operationIdが既にTransactionLogに存在するか確認する（時差更新の冪等判定、sequence.md 2.6）
 */
export async function findTransactionByOperationId(operationId: string): Promise<TransactionRow | null> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: TRANSACTION_RANGE,
  })
  const rows = res.data.values || []
  for (const row of rows) {
    if (String(row[6] ?? '') === operationId) {
      return {
        transactionId: toNum(row[0]),
        transactionAt: String(row[1] ?? ''),
        itemId: String(row[2] ?? ''),
        type: (row[3] === 'OUT' ? 'OUT' : 'IN'),
        quantity: toNum(row[4]),
        userEmail: String(row[5] ?? ''),
        operationId: String(row[6] ?? ''),
      }
    }
  }
  return null
}

/**
 * TransactionLogへ1行追記する（追記専用。呼び出し元がロック区間内で使うこと）
 */
export async function appendTransaction(tx: TransactionRow): Promise<void> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSpreadsheetId,
    range: TRANSACTION_APPEND_RANGE,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[tx.transactionId, tx.transactionAt, tx.itemId, tx.type, tx.quantity, tx.userEmail, tx.operationId]],
    },
  })
}

// --- 通知先設定(NotificationTargets) ---

export async function getNotificationTargets(): Promise<NotificationTargetRow[]> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: NOTIFICATION_RANGE,
  })
  return (res.data.values || []).map((row) => ({
    targetId: String(row[0] ?? ''),
    email: String(row[1] ?? ''),
    updatedAt: String(row[2] ?? ''),
  }))
}

/**
 * TAR- の最大連番を取得する（呼び出し元がロック区間内で使うこと）
 */
export async function getMaxTargetIdSeq(): Promise<number> {
  const targets = await getNotificationTargets()
  let max = 0
  for (const t of targets) {
    const m = /^TAR-(\d{3})$/.exec(t.targetId)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

export async function appendNotificationTarget(target: NotificationTargetRow): Promise<void> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSpreadsheetId,
    range: NOTIFICATION_APPEND_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [[target.targetId, target.email, target.updatedAt]] },
  })
}

/**
 * targetIdの行を削除する（行削除のためbatchUpdateのdeleteDimensionを使う）
 */
export async function deleteNotificationTarget(targetId: string): Promise<boolean> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: NOTIFICATION_RANGE,
  })
  const rows = res.data.values || []
  const index = rows.findIndex((row) => String(row[0] ?? '') === targetId)
  if (index === -1) return false

  const sheetId = await getSheetIdByName('NotificationTargets')
  const sheetRow = index + 1 // A2始まり(ヘッダーがrow0) → 0始まりのシート行番号
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.googleSpreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: sheetRow + 1, endIndex: sheetRow + 2 },
          },
        },
      ],
    },
  })
  return true
}

const sheetIdCache = new Map<string, number>()
async function getSheetIdByName(title: string): Promise<number> {
  if (sheetIdCache.has(title)) return sheetIdCache.get(title)!
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.get({ spreadsheetId: config.googleSpreadsheetId })
  const sheet = res.data.sheets?.find((s) => s.properties?.title === title)
  const sheetId = sheet?.properties?.sheetId ?? 0
  sheetIdCache.set(title, sheetId)
  return sheetId
}

// --- 許可リスト(AllowList) ---

export async function getUsers(): Promise<AllowListRow[]> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: ALLOWLIST_RANGE,
  })
  return (res.data.values || []).map((row) => ({
    allowId: String(row[0] ?? ''),
    email: String(row[1] ?? ''),
    passwordHash: String(row[2] ?? ''),
    targetId: String(row[3] ?? ''),
    retiredFlag: toBool(row[4]),
    updatedAt: String(row[5] ?? ''),
  }))
}

export async function findUserByEmail(email: string): Promise<AllowListRow | null> {
  const users = await getUsers()
  return users.find((u) => u.email === email) || null
}

export async function findUserByAllowId(allowId: string): Promise<AllowListRow | null> {
  const users = await getUsers()
  return users.find((u) => u.allowId === allowId) || null
}

/**
 * AllowListの該当行のパスワードハッシュ・更新年月日を更新する（ロック対象外、overview.md 6.1）
 */
export async function updateUserPassword(allowId: string, passwordHash: string, updatedAt: string): Promise<boolean> {
  const sheets = await getSheetsClient()
  const config = useRuntimeConfig()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: ALLOWLIST_RANGE,
  })
  const rows = res.data.values || []
  const index = rows.findIndex((row) => String(row[0] ?? '') === allowId)
  if (index === -1) return false

  const sheetRow = index + 2
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSpreadsheetId,
    range: `AllowList!C${sheetRow}:C${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[passwordHash]] },
  })
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSpreadsheetId,
    range: `AllowList!F${sheetRow}:F${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[updatedAt]] },
  })
  return true
}

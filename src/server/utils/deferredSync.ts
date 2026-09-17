// ロジック層(排他制御／時差更新ドメイン): 蓄積データの後追い適用（FR-15、要件3-12、sequence.md 2.6）。
interface PendingOperation {
  operationId: string
  itemId: string
  type: 'IN' | 'OUT'
  quantity: number
  operator: string
  occurredAt: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isQuotaExceeded(e: unknown): boolean {
  const err = e as { code?: number; message?: string }
  return err.code === 429 || /RESOURCE_EXHAUSTED/i.test(err.message ?? '')
}

/**
 * pending/直下（pending/alerts/を除く）を名前順に後追い適用する。管理者のみが呼ぶ（3-12）。
 * @returns 適用件数・残件数
 */
export async function runDeferredSync(): Promise<{ applied: number; remaining: number }> {
  const allNames = await listObjectNames('pending/')
  const names = allNames.filter((n) => !n.startsWith('pending/alerts/') && n.endsWith('.json'))

  let applied = 0
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!
    const op = await getObjectJson<PendingOperation>(name)
    if (!op) continue

    const success = await applyOneWithBackoff(op)
    if (success) {
      await deleteObject(name)
      applied++
    } else {
      break // 打ち切って残件を保持（overview.md 6.2/6.7）
    }

    if (i < names.length - 1) await sleep(1500) // Sheetsクォータ対策（1件あたり約1.5秒）
  }

  const remainingNames = await listObjectNames('pending/')
  const remaining = remainingNames.filter((n) => !n.startsWith('pending/alerts/') && n.endsWith('.json')).length
  return { applied, remaining }
}

async function applyOneWithBackoff(op: PendingOperation): Promise<boolean> {
  const delays = [2000, 4000, 8000]
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await applyOne(op)
      return true
    } catch (e) {
      if (!isQuotaExceeded(e) || attempt === delays.length) {
        console.error(e)
        return false
      }
      await sleep(delays[attempt]!)
    }
  }
  return false
}

async function applyOne(op: PendingOperation): Promise<void> {
  const result = await withLock(async () => {
    const alreadyApplied = await findTransactionByOperationId(op.operationId)
    const found = await findInventoryRowIndex(op.itemId)
    if (!found) return // 品目が存在しない場合は棚卸で解消(NR-02)。ここでは何もしない

    const { row, index } = found
    const newStock = op.type === 'IN' ? row.currentStock + op.quantity : row.currentStock - op.quantity
    const wasAlertSent = row.alertSentFlag
    const updatedRow = { ...row, currentStock: newStock, updatedAt: new Date().toISOString() }

    if (op.type === 'IN' && newStock >= row.threshold && wasAlertSent) {
      updatedRow.alertSentFlag = false
    }

    if (!alreadyApplied) {
      await appendTransaction({
        transactionId: formatTransactionId((await getMaxTransactionId()) + 1),
        transactionAt: op.occurredAt,
        itemId: op.itemId,
        type: op.type,
        quantity: op.quantity,
        userEmail: op.operator,
        operationId: op.operationId,
      })
    }
    await updateInventoryRow(index, updatedRow)

    if (op.type === 'IN' && updatedRow.alertSentFlag === false && wasAlertSent) {
      await deleteObject(`pending/alerts/${op.itemId}.json`).catch(() => undefined)
    }
    if (op.type === 'OUT' && newStock < row.threshold && !wasAlertSent) {
      await sendAlertForItem({ itemId: op.itemId, itemName: row.itemName, threshold: row.threshold, currentStock: newStock }).catch((e) =>
        console.error(e)
      )
    }
  })

  if (result === null) {
    // ロック取得失敗。この回は打ち切り、当該pendingは保持して再実施を促す（呼び出し元でbreak）
    throw new Error('LOCK_TIMEOUT')
  }
}

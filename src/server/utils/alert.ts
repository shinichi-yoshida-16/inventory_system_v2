// ロジック層(在庫通知管理ドメイン): 通知先設定への在庫アラートメール送信・マージ送信（FR-09、overview.md 4.4/6.4）。
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { NotificationTargetRow } from './sheets'

interface AlertItem {
  itemId: string
  itemName: string
  threshold: number
  currentStock: number
}

interface PendingAlert {
  itemId: string
  itemName: string
  threshold: number
  detectedStock: number
  detectedAt: string
}

function nowIso(): string {
  return new Date().toISOString()
}

let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (transporter) return transporter
  const config = useRuntimeConfig()
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: config.gmailSender, pass: config.gmailAppPassword.replace(/\s+/g, '') },
  })
  return transporter
}

async function sendMail(html: string): Promise<void> {
  const config = useRuntimeConfig()
  const targets = await getNotificationTargets()
  if (targets.length === 0) return

  await getTransporter().sendMail({
    from: `在庫管理システム <${config.gmailSender}>`,
    to: targets.map((t) => t.email),
    subject: '在庫数アラート',
    html,
  })
}

function isSendFailureRetryable(e: unknown): boolean {
  // 429 / RESOURCE_EXHAUSTED を含め、送信失敗は一律マージ対象として扱う（overview.md 4.4）
  void e
  return true
}

/**
 * 出庫直後のアラート送信要否判定を受けて呼ばれる。ロック解放後の独立系（overview.md 4.4）。
 * 送信成功でalertSentFlag=true、失敗（429含む）はpending/alerts/へ退避し当日は再送しない。
 */
export async function sendAlertForItem(item: AlertItem): Promise<void> {
  const html = `${item.itemName}の在庫が閾値以下です。<br>確認してください。`

  try {
    await sendMail(html)
    await markAlertSent(item.itemId)
  } catch (e) {
    if (!isSendFailureRetryable(e)) throw e
    const pending: PendingAlert = {
      itemId: item.itemId,
      itemName: item.itemName,
      threshold: item.threshold,
      detectedStock: item.currentStock,
      detectedAt: nowIso(),
    }
    await insertObject(`pending/alerts/${item.itemId}.json`, pending)
  }
}

async function markAlertSent(itemId: string): Promise<void> {
  const found = await findInventoryRowIndex(itemId)
  if (!found) return
  await updateInventoryRow(found.index, { ...found.row, alertSentFlag: true, updatedAt: nowIso() })
}

/**
 * 管理者ログイン成功時に呼ぶ。pending/alerts/の保留分を1通にまとめて送信し、
 * 成功した品目のalertSentFlagをtrueにして該当オブジェクトを削除する（overview.md 6.4）。
 */
export async function sendMergedAlertsIfAny(): Promise<void> {
  const names = await listObjectNames('pending/alerts/')
  if (names.length === 0) return

  const items: PendingAlert[] = []
  for (const name of names) {
    const item = await getObjectJson<PendingAlert>(name)
    if (item) items.push(item)
  }
  if (items.length === 0) return

  const body = items.map((i) => `${i.itemName}の在庫が閾値以下です。<br>`).join('') + '確認お願いします。'

  try {
    await sendMail(body)
  } catch (e) {
    console.error(e)
    return // 送信できなければオブジェクトを残し、次回の管理者ログインで再試行する
  }

  for (const item of items) {
    await markAlertSent(item.itemId)
    await deleteObject(`pending/alerts/${item.itemId}.json`)
  }
}

// --- 通知先設定(NotificationTargets, FR-09/3-9) ---

export async function listNotificationTargets(): Promise<Pick<NotificationTargetRow, 'targetId' | 'email'>[]> {
  const targets = await getNotificationTargets()
  return targets.map((t) => ({ targetId: t.targetId, email: t.email }))
}

export async function addNotificationTarget(email: string): Promise<{ targetId: string; email: string }> {
  const result = await withLock(async () => {
    const existing = await getNotificationTargets()
    if (existing.some((t) => t.email === email)) {
      throw new ApiError('INVALID_INPUT', 'すでに登録されているメールアドレスです')
    }
    const targetId = formatTargetId((await getMaxTargetIdSeq()) + 1)
    const updatedAt = nowIso()
    await appendNotificationTarget({ targetId, email, updatedAt })
    await updateUserTargetId(email, targetId, updatedAt)
    return { targetId, email }
  })

  if (result === null) {
    throw new ApiError('LOCK_TIMEOUT', '排他ロックを取得できませんでした。再実行してください')
  }
  return result
}

export async function removeNotificationTarget(targetId: string): Promise<void> {
  const result = await withLock(async () => {
    const deleted = await deleteNotificationTarget(targetId)
    if (deleted) {
      const linkedUser = (await getUsers()).find((u) => u.targetId === targetId)
      if (linkedUser) {
        await updateUserTargetId(linkedUser.email, '', nowIso())
      }
    }
    return deleted
  })

  if (result === null) {
    throw new ApiError('LOCK_TIMEOUT', '排他ロックを取得できませんでした。再実行してください')
  }
  if (!result) {
    throw new ApiError('INVALID_INPUT', '対象が見つかりません')
  }
}

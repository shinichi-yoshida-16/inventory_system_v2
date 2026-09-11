// POST /api/notification-targets（通知先追加、管理者のみ、FR-09/3-9）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineApi(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ email?: unknown }>(event)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new ApiError('INVALID_INPUT', 'メールアドレスを正しく入力してください')
  }

  return await addNotificationTarget(email)
})

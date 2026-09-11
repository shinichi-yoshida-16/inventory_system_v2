// DELETE /api/notification-targets（通知先削除、管理者のみ、FR-09/3-9）
export default defineApi(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ targetId?: unknown }>(event)
  const targetId = typeof body?.targetId === 'string' ? body.targetId : ''

  if (!targetId) {
    throw new ApiError('INVALID_INPUT', 'targetIdを指定してください')
  }

  await removeNotificationTarget(targetId)
  return null
})

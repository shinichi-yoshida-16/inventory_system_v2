// GET /api/notification-targets（通知先一覧、管理者のみ、FR-09/3-9）
export default defineApi(async (event) => {
  await requireAdmin(event)
  return await listNotificationTargets()
})

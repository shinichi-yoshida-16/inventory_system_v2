// POST /api/deferred-sync（時差更新の後追い適用、管理者のみ、FR-15/3-12）
export default defineApi(async (event) => {
  await requireAdmin(event)
  return await runDeferredSync()
})

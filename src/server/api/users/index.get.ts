// GET /api/users（許可リスト一覧、管理者のみ、3-10）
export default defineApi(async (event) => {
  await requireAdmin(event)
  return await listUsers()
})

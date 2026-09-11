// GET /api/inventory（在庫一覧、FR-02/3-4）
export default defineApi(async (event) => {
  await requireSession(event)
  return await listInventory()
})

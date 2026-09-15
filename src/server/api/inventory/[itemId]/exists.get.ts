// GET /api/inventory/{itemIdまたはgtin}/exists（品目存在確認、FR-05）
// 未登録は正常フロー（新規登録への分岐）のため、404ではなく200で{exists:false}を返す
export default defineApi(async (event) => {
  await requireSession(event)
  const value = getRouterParam(event, 'itemId') ?? ''

  if (!ITEM_ID_RE.test(value) && !GTIN_RE.test(value)) {
    throw new ApiError('INVALID_INPUT', 'itemIdまたはGTINの形式が正しくありません')
  }

  const row = await findItemByIdOrGtin(value)
  if (!row) return { exists: false as const }
  return { exists: true as const, itemId: row.itemId, itemName: row.itemName, currentStock: row.currentStock }
})

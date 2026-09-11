// GET /api/inventory/{itemIdまたはgtin}（品目単体取得、FR-05/3-5〜3-7、overview.md 4.1/4.6）
export default defineApi(async (event) => {
  await requireSession(event)
  const value = getRouterParam(event, 'itemId') ?? ''

  if (!ITEM_ID_RE.test(value) && !GTIN_RE.test(value)) {
    throw new ApiError('INVALID_INPUT', 'itemIdまたはGTINの形式が正しくありません')
  }

  return await getItemByIdOrGtin(value)
})

// PUT /api/inventory/{itemId}/discontinued（廃番フラグ更新、管理者のみ、FR-11）
export default defineApi(async (event) => {
  await requireAdmin(event)
  const itemId = getRouterParam(event, 'itemId') ?? ''
  if (!ITEM_ID_RE.test(itemId)) {
    throw new ApiError('INVALID_INPUT', 'itemIdの形式が正しくありません')
  }

  const body = await readBody<{ discontinued?: unknown }>(event)
  if (typeof body?.discontinued !== 'boolean') {
    throw new ApiError('INVALID_INPUT', 'discontinuedはtrue/falseで指定してください')
  }

  await updateDiscontinued(itemId, body.discontinued)
  return null
})

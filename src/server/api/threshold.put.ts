// PUT /api/threshold（品目ごとの閾値更新、複数一括、管理者のみ、FR-08/3-8）
interface ThresholdItemBody {
  itemId?: unknown
  threshold?: unknown
}

export default defineApi(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ items?: ThresholdItemBody[] }>(event)

  if (!Array.isArray(body?.items) || body.items.length === 0) {
    throw new ApiError('INVALID_INPUT', 'itemsは1件以上の配列で指定してください')
  }

  const items = body.items.map((item) => {
    const itemId = typeof item?.itemId === 'string' ? item.itemId : ''
    if (!ITEM_ID_RE.test(itemId)) {
      throw new ApiError('INVALID_INPUT', 'itemIdの形式が正しくありません')
    }
    const threshold = Number(item?.threshold)
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new ApiError('INVALID_INPUT', '閾値は0以上の整数で指定してください')
    }
    return { itemId, threshold }
  })

  const updated = await updateThresholds(items)
  return { updated }
})

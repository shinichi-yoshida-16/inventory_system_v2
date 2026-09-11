// POST /api/scan（入出庫・未登録品目の自動登録、FR-06/FR-07/FR-12、overview.md 4.2/4.6）
interface ScanBody {
  itemId?: unknown
  gtin?: unknown
  type?: unknown
  quantity?: unknown
  itemName?: unknown
  threshold?: unknown
  location?: unknown
}

export default defineApi(async (event) => {
  const auth = await requireSession(event)
  const body = await readBody<ScanBody>(event)

  const type = body?.type === 'IN' || body?.type === 'OUT' ? body.type : null
  if (!type) throw new ApiError('INVALID_INPUT', 'type は IN または OUT で指定してください')

  const quantity = Number(body?.quantity)
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ApiError('INVALID_INPUT', 'quantity は1以上の整数で指定してください')
  }

  const itemIdRaw = typeof body?.itemId === 'string' ? body.itemId.trim() : ''
  const isNewRegistration = itemIdRaw === ''

  if (!isNewRegistration) {
    if (!ITEM_ID_RE.test(itemIdRaw)) {
      throw new ApiError('INVALID_INPUT', 'itemIdの形式が正しくありません')
    }
    const result = await scan({ itemId: itemIdRaw, type, quantity, operator: auth.email })
    return result
  }

  // 新規登録（FR-12）
  if (type !== 'IN' || quantity !== 1) {
    throw new ApiError('INVALID_INPUT', '新規登録時は type=IN, quantity=1 で指定してください')
  }
  const itemName = typeof body?.itemName === 'string' ? body.itemName.trim() : ''
  if (!itemName || itemName.length > 100) {
    throw new ApiError('INVALID_INPUT', '品目名を1〜100文字で入力してください')
  }
  const threshold = Number(body?.threshold)
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new ApiError('INVALID_INPUT', '閾値は0以上の整数で指定してください')
  }
  const location = typeof body?.location === 'string' ? body.location.trim() : ''
  if (location.length > 100) {
    throw new ApiError('INVALID_INPUT', '保管場所は100文字以内で入力してください')
  }
  let gtin: string | undefined
  if (body?.gtin !== undefined && body?.gtin !== null && body?.gtin !== '') {
    if (typeof body.gtin !== 'string' || !GTIN_RE.test(body.gtin)) {
      throw new ApiError('INVALID_INPUT', 'gtinの形式が正しくありません')
    }
    gtin = body.gtin
  }

  return await scan({ type, quantity, itemName, threshold, location, gtin, operator: auth.email })
})

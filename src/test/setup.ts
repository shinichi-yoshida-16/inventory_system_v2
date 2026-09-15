// server/utils配下・server/api配下のファイルはNitroの自動importで
// h3のユーティリティやApiError等を（importなしで）参照している。
// vitestは実際のNitroビルドを通さないため、ここで同名のglobalを用意し実行時解決できるようにする。
// findInventoryRowIndex / findItemByIdOrGtin 等、テストごとに挙動を切り替えたいものは各テストファイル側でstubする。
import { vi } from 'vitest'
import { defineEventHandler, getRouterParam, getHeader, setResponseStatus } from 'h3'
import { ApiError } from '../server/utils/apiError'
import { defineApi } from '../server/utils/handler'
import { ITEM_ID_RE, GTIN_RE } from '../server/utils/inventory'

vi.stubGlobal('defineEventHandler', defineEventHandler)
vi.stubGlobal('getRouterParam', getRouterParam)
vi.stubGlobal('getHeader', getHeader)
vi.stubGlobal('setResponseStatus', setResponseStatus)
vi.stubGlobal('ApiError', ApiError)
vi.stubGlobal('defineApi', defineApi)
vi.stubGlobal('ITEM_ID_RE', ITEM_ID_RE)
vi.stubGlobal('GTIN_RE', GTIN_RE)

// セッション検証はテスト対象外のため、既定では常に成功させる（認証エラー経路を見たいテストは個別に上書きする）
vi.stubGlobal(
  'requireSession',
  vi.fn().mockResolvedValue({ allowId: '1', email: 'test@example.com' })
)

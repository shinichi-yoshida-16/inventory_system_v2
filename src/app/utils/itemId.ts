// FEユーティリティ: 読み取りコードの正規化（overview.md 4.5、要件FR-05/FR-12）。
// 自社発行QR(ITM-)はitemIdとしてそのまま使い、JAN(EAN-13)/GS1 DataMatrixはGTIN-14へ正規化する。
// GS1パーサは技術検証（verification/04b_gs1_parser.mjs）の参考実装を土台に書き起こしたもの。

export type NormalizedCode = { kind: 'itemId'; value: string } | { kind: 'gtin'; value: string }

const ITEM_ID_RE = /^ITM-\d{6}$/
const JAN13_RE = /^\d{13}$/

// 固定長AI(AI → データ長)。可変長AIはFNC1(\x1d)または文字列末尾まで(overview.md 4.5)。
const FIXED_LENGTH_AI: Record<string, number> = {
  '00': 18,
  '01': 14,
  '02': 14,
  '11': 6,
  '12': 6,
  '13': 6,
  '15': 6,
  '17': 6,
  '20': 2,
}
const VARIABLE_KNOWN_AI = new Set(['10', '21', '240'])

/**
 * GTIN-14のチェックディジットを検証する（ISO/IEC標準のmod10、右端から3,1の交互加重）
 */
export function isValidGtin14(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false
  const digits = gtin.slice(0, 13)
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i])
    const weight = i % 2 === 0 ? 3 : 1
    sum += digit * weight
  }
  const checkDigit = (10 - (sum % 10)) % 10
  return checkDigit === Number(gtin[13])
}

/**
 * GS1 Application Identifier構造からAI「01」(GTIN)を抽出する。
 * 未知のAI・01が見つからない場合は例外を投げ、誤った値をitemIdとして登録しない(要件10章)。
 */
function extractGtinFromGs1(raw: string): string {
  const s = raw.replace(/^\]d2/, '').replace(/^\x1d/, '')
  const found: Record<string, string> = {}
  let i = 0
  while (i < s.length) {
    const ai2 = s.slice(i, i + 2)
    let ai: string
    let fixedLen: number | null

    if (FIXED_LENGTH_AI[ai2] != null) {
      ai = ai2
      fixedLen = FIXED_LENGTH_AI[ai2]
    } else if (VARIABLE_KNOWN_AI.has(ai2)) {
      ai = ai2
      fixedLen = null
    } else {
      const ai3 = s.slice(i, i + 3)
      if (VARIABLE_KNOWN_AI.has(ai3)) {
        ai = ai3
        fixedLen = null
      } else {
        throw new Error(`未対応のバーコード形式です（AI: ${s.slice(i, i + 4)}）`)
      }
    }
    i += ai.length

    let value: string
    if (fixedLen != null) {
      value = s.slice(i, i + fixedLen)
      i += fixedLen
    } else {
      const gsIndex = s.indexOf('\x1d', i)
      const end = gsIndex === -1 ? s.length : gsIndex
      value = s.slice(i, end)
      i = end === s.length ? end : end + 1
    }
    found[ai] = value
  }

  const gtin = found['01']
  if (!gtin) {
    throw new Error('GTIN(AI 01)が見つかりません')
  }
  return gtin
}

/**
 * D-03で読み取った文字列を正規化する。自社発行QRはitemId、JAN/GS1 DataMatrixはGTIN-14を返す。
 * 未対応形式・チェックディジット不一致は例外を投げる。
 */
export function normalizeScannedCode(raw: string): NormalizedCode {
  const trimmed = raw.trim()

  if (ITEM_ID_RE.test(trimmed)) {
    return { kind: 'itemId', value: trimmed }
  }

  if (JAN13_RE.test(trimmed)) {
    const gtin = `0${trimmed}`
    if (!isValidGtin14(gtin)) {
      throw new Error('バーコードのチェックディジットが一致しません')
    }
    return { kind: 'gtin', value: gtin }
  }

  const gtin = extractGtinFromGs1(trimmed)
  if (!isValidGtin14(gtin)) {
    throw new Error('バーコードのチェックディジットが一致しません')
  }
  return { kind: 'gtin', value: gtin }
}

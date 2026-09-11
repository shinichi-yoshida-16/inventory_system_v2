// FEユーティリティ: User-Agentによる端末判定（transition.md 3章）。
// navigator.userAgentがMobi/Android/iPhone/iPodを含めば「スマホ」、それ以外は「PC」とする。
const MOBILE_UA_RE = /Mobi|Android|iPhone|iPod/

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return MOBILE_UA_RE.test(navigator.userAgent)
}

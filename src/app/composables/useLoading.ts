// 状態管理層: 画面処理中フラグ（D-06 ローディングオーバーレイ、transition.md「ローディング表示」）。
// 同時に走るAPI呼び出しがあっても最後の1件が終わるまで表示し続けるようカウンタで管理する。
export const useLoading = () => {
  const count = useState<number>('loading:count', () => 0)
  const isLoading = computed(() => count.value > 0)

  const start = () => {
    count.value++
  }

  const stop = () => {
    count.value = Math.max(0, count.value - 1)
  }

  return { isLoading, start, stop }
}

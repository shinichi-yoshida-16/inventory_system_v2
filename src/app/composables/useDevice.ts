// 状態管理層: UA端末判定のリアクティブラッパー（transition.md 3章）。
// SSR時はnavigatorが無いためfalseとし、クライアントでのマウント後に確定する。
export const useDevice = () => {
  const isMobile = useState<boolean>('device:isMobile', () => false)

  onMounted(() => {
    isMobile.value = isMobileDevice()
  })

  const isDesktop = computed(() => !isMobile.value)
  return { isMobile, isDesktop }
}

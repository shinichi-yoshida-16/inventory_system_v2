export default defineNuxtRouteMiddleware(async () => {
  const { isLoggedIn, restoreSession } = useAuth()

  if (!isLoggedIn.value) {
    await restoreSession()
  }
  if (!isLoggedIn.value) {
    return navigateTo('/')
  }
})
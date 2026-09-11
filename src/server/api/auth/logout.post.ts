// POST /api/auth/logout（3-3）
export default defineApi(async (event) => {
  const sessionId = getHeader(event, 'x-session-id')
  if (sessionId) {
    await deleteSession(sessionId)
  }
  return null
})

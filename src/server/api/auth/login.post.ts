// POST /api/auth/login（FR-01、3-2）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineApi(async (event) => {
  const body = await readBody<{ email?: unknown; password?: unknown }>(event)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new ApiError('INVALID_INPUT', 'メールアドレスを正しく入力してください')
  }
  if (!password || password.length < 1 || password.length > 72) {
    throw new ApiError('INVALID_INPUT', 'パスワードを入力してください')
  }

  const row = await authenticate(email, password)
  if (!row) {
    throw new ApiError('AUTH_FAILED', 'メールアドレスまたはパスワードが違います')
  }

  const session = await createSession({ allowId: row.allowId, email: row.email })
  const admin = isAdminRow(row)

  if (admin) {
    await sendMergedAlertsIfAny().catch((e) => console.error(e))
  }

  return {
    sessionId: session.sessionId,
    user: { email: row.email, isAdmin: admin },
  }
})

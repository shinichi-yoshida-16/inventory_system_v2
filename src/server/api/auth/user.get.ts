// GET /api/auth/user（セッション検証・有効期限延長、3-3）
export default defineApi(async (event) => {
  const auth = await requireSession(event)
  const row = await findUserByEmail(auth.email)
  const isAdmin = row ? isAdminRow(row) : false

  return { user: { email: auth.email, isAdmin } }
})

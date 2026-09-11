// PUT /api/user/password（ログイン中ユーザ自身のパスワード更新、FR-13/3-10）
export default defineApi(async (event) => {
  const auth = await requireSession(event)
  const body = await readBody<{ newPassword?: unknown; newPasswordConfirm?: unknown }>(event)
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  const newPasswordConfirm = typeof body?.newPasswordConfirm === 'string' ? body.newPasswordConfirm : ''

  if (newPassword.length < 8 || newPassword.length > 72) {
    throw new ApiError('INVALID_INPUT', 'パスワードは8〜72文字で入力してください')
  }
  if (newPassword !== newPasswordConfirm) {
    throw new ApiError('INVALID_INPUT', '確認用パスワードが一致しません')
  }

  await setPassword(auth.allowId, newPassword)
  return null
})

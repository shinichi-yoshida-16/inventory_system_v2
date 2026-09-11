// PUT /api/users/{allowId}/password（管理者による対象ユーザのパスワードリセット、3-10）
export default defineApi(async (event) => {
  await requireAdmin(event)
  const allowId = getRouterParam(event, 'allowId')
  if (!allowId) throw new ApiError('INVALID_INPUT', 'allowIdが指定されていません')

  const target = await findUserByAllowId(allowId)
  if (!target) throw new ApiError('INVALID_INPUT', '対象ユーザが見つかりません')

  const body = await readBody<{ newPassword?: unknown; newPasswordConfirm?: unknown }>(event)
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  const newPasswordConfirm = typeof body?.newPasswordConfirm === 'string' ? body.newPasswordConfirm : ''

  if (newPassword.length < 8 || newPassword.length > 72) {
    throw new ApiError('INVALID_INPUT', 'パスワードは8〜72文字で入力してください')
  }
  if (newPassword !== newPasswordConfirm) {
    throw new ApiError('INVALID_INPUT', '確認用パスワードが一致しません')
  }

  await setPassword(allowId, newPassword)
  return null
})

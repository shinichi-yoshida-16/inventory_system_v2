// ロジック層: 許可リスト参照・パスワード再ハッシュ（overview.md 3.1、sequence.md 2.7）。
// 認証(login)照合とパスワード再ハッシュのロジックを共用する。パスワード更新はlocks/inventory.lock対象外（6.1）。
import bcrypt from 'bcryptjs'

export interface UserSummary {
  allowId: string
  email: string
  isAdmin: boolean
  updatedAt: string
}

const BCRYPT_ROUNDS = 10

/**
 * AllowList行から管理者判定を行う（F列adminFlag、database.md 4章）
 */
export function isAdminRow(row: { adminFlag: boolean }): boolean {
  return row.adminFlag
}

/**
 * メール＋パスワードをAllowListと照合する（FR-01）。未登録／不一致／退職はすべてnullで返す（列挙攻撃対策）
 */
export async function authenticate(email: string, password: string) {
  const row = await findUserByEmail(email)
  if (!row) return null
  if (row.retiredFlag) return null

  const valid = await bcrypt.compare(password, row.passwordHash)
  if (!valid) return null

  return row
}

/**
 * 許可リスト一覧を取得する（パスワードハッシュは含めない。管理者のみが呼ぶ、3-10）。
 * 退職済みユーザは表示しない（退職有無は別システムで管理するため）
 */
export async function listUsers(): Promise<UserSummary[]> {
  const rows = await getUsers()
  return rows
    .filter((r) => !r.retiredFlag)
    .map((r) => ({
      allowId: r.allowId,
      email: r.email,
      isAdmin: isAdminRow(r),
      updatedAt: r.updatedAt,
    }))
}

/**
 * 新パスワードをbcryptハッシュ化してAllowListへ反映する（本人・管理者のリセット共用）
 */
export async function setPassword(allowId: string, newPassword: string): Promise<boolean> {
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  return updateUserPassword(allowId, hash, new Date().toISOString())
}

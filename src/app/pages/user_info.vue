<script setup lang="ts">
// D-10: ユーザ情報画面（FR-13/3-10、管理者のみ通知先設定 3-9/FR-09）
definePageMeta({ middleware: 'auth' })

interface UserSummary {
  allowId: string
  email: string
  isAdmin: boolean
  retiredFlag: boolean
  updatedAt: string
}
interface NotificationTarget {
  targetId: string
  email: string
}
interface MergedUserRow {
  allowId: string | null
  email: string
  isAdmin: boolean
  retiredFlag: boolean
  targetId: string | null
}

const { apiFetch } = useApi()
const { isAdmin } = useAuth()

// 自分のパスワード変更
const newPassword = ref('')
const newPasswordConfirm = ref('')
const selfMessage = ref('')
const selfError = ref('')

const handleChangeOwnPassword = async () => {
  selfMessage.value = ''
  selfError.value = ''
  try {
    await apiFetch('/api/user/password', {
      method: 'PUT',
      body: { newPassword: newPassword.value, newPasswordConfirm: newPasswordConfirm.value },
    })
    selfMessage.value = 'パスワードを更新しました'
    newPassword.value = ''
    newPasswordConfirm.value = ''
  } catch (e) {
    selfError.value = e instanceof Error ? e.message : '更新に失敗しました'
  }
}

// 管理者: 許可リスト閲覧・パスワードリセット
const users = ref<UserSummary[]>([])
const listError = ref('')
const resetTargetAllowId = ref('')
const resetPassword = ref('')
const resetPasswordConfirm = ref('')
const resetMessage = ref('')
const resetError = ref('')

const loadUsers = async () => {
  listError.value = ''
  try {
    users.value = await apiFetch<UserSummary[]>('/api/users')
  } catch (e) {
    listError.value = e instanceof Error ? e.message : '取得に失敗しました'
  }
}

// 管理者: 通知先設定
const targets = ref<NotificationTarget[]>([])
const newTargetEmail = ref('')
const targetError = ref('')

const loadTargets = async () => {
  targetError.value = ''
  try {
    targets.value = await apiFetch<NotificationTarget[]>('/api/notification-targets')
  } catch (e) {
    targetError.value = e instanceof Error ? e.message : '取得に失敗しました'
  }
}

onMounted(() => {
  if (isAdmin.value) {
    loadUsers()
    loadTargets()
  }
})

// 許可リストと通知先を1テーブルにマージ表示（メールアドレスで対応付け）
const mergedRows = computed<MergedUserRow[]>(() => {
  const rows: MergedUserRow[] = users.value.map((u) => {
    const target = targets.value.find((t) => t.email === u.email)
    return {
      allowId: u.allowId,
      email: u.email,
      isAdmin: u.isAdmin,
      retiredFlag: u.retiredFlag,
      targetId: target?.targetId ?? null,
    }
  })

  for (const target of targets.value) {
    if (rows.some((r) => r.email === target.email)) continue
    rows.push({ allowId: null, email: target.email, isAdmin: false, retiredFlag: false, targetId: target.targetId })
  }

  return rows
})

const handleToggleTarget = async (row: MergedUserRow) => {
  targetError.value = ''
  try {
    if (row.targetId) {
      await apiFetch('/api/notification-targets', { method: 'DELETE', body: { targetId: row.targetId } })
    } else {
      await apiFetch('/api/notification-targets', { method: 'POST', body: { email: row.email } })
    }
    await loadTargets()
  } catch (e) {
    targetError.value = e instanceof Error ? e.message : '更新に失敗しました'
  }
}

const handleResetPassword = async () => {
  resetMessage.value = ''
  resetError.value = ''
  try {
    await apiFetch(`/api/users/${resetTargetAllowId.value}/password`, {
      method: 'PUT',
      body: { newPassword: resetPassword.value, newPasswordConfirm: resetPasswordConfirm.value },
    })
    resetMessage.value = 'パスワードをリセットしました（本人へは口頭等で伝達してください）'
    resetPassword.value = ''
    resetPasswordConfirm.value = ''
  } catch (e) {
    resetError.value = e instanceof Error ? e.message : 'リセットに失敗しました'
  }
}

const handleAddTarget = async () => {
  targetError.value = ''
  try {
    await apiFetch('/api/notification-targets', { method: 'POST', body: { email: newTargetEmail.value } })
    newTargetEmail.value = ''
    await loadTargets()
  } catch (e) {
    targetError.value = e instanceof Error ? e.message : '追加に失敗しました'
  }
}
</script>

<template>
  <h1>ユーザ情報</h1>
  <button @click="navigateTo('/dashboard')">ダッシュボードに戻る</button>

  <section>
    <h2>パスワード変更</h2>
    <p>新しいパスワード: <input v-model="newPassword" type="password" /></p>
    <p>確認用: <input v-model="newPasswordConfirm" type="password" /></p>
    <button @click="handleChangeOwnPassword">更新</button>
    <p v-if="selfMessage" style="color: green">{{ selfMessage }}</p>
    <p v-if="selfError" style="color: red">{{ selfError }}</p>
  </section>

  <section v-if="isAdmin">
    <h2>許可リスト・通知先設定（管理者機能）</h2>
    <p v-if="listError" style="color: red">{{ listError }}</p>

    <div class="table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>許可ID</th>
            <th>メールアドレス</th>
            <th class="col-center">管理者</th>
            <th class="col-center">退職</th>
            <th class="col-center">通知先</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in mergedRows" :key="row.email">
            <td data-label="許可ID">{{ row.allowId ?? '-' }}</td>
            <td data-label="メールアドレス">{{ row.email }}</td>
            <td class="col-center" data-label="管理者">{{ row.isAdmin ? '○' : '' }}</td>
            <td class="col-center" data-label="退職">{{ row.retiredFlag ? '○' : '' }}</td>
            <td class="col-center" data-label="通知先">
              <input type="checkbox" :checked="!!row.targetId" @change="handleToggleTarget(row)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <input v-model="newTargetEmail" type="email" placeholder="通知先メールアドレス（許可リストにないアドレスを追加）" />
    <button @click="handleAddTarget">追加</button>
    <p v-if="targetError" style="color: red">{{ targetError }}</p>

    <h3>パスワードのリセット</h3>
    <select v-model="resetTargetAllowId">
      <option value="" disabled>対象ユーザを選択してください</option>
      <option v-for="u in users" :key="u.allowId" :value="u.allowId">{{ u.email }}</option>
    </select>
    <p>新しいパスワード: <input v-model="resetPassword" type="password" /></p>
    <p>確認用: <input v-model="resetPasswordConfirm" type="password" /></p>
    <button :disabled="!resetTargetAllowId" @click="handleResetPassword">リセット</button>
    <p v-if="resetMessage" style="color: green">{{ resetMessage }}</p>
    <p v-if="resetError" style="color: red">{{ resetError }}</p>
  </section>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.user-table thead th {
  position: sticky;
  top: 0;
  background: #f5f6f8;
  text-align: left;
  padding: 0.6rem 0.8rem;
  border-bottom: 2px solid #ddd;
  white-space: nowrap;
}

.user-table td {
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid #eee;
}

.user-table tbody tr:nth-child(even) {
  background: #fafafa;
}

.user-table tbody tr:hover {
  background: #eef4ff;
}

.col-center {
  text-align: center;
}

/* スマホ幅ではテーブルをCSS Gridのカード表示に切り替える */
@media (max-width: 560px) {
  .user-table thead {
    display: none;
  }

  .user-table,
  .user-table tbody,
  .user-table tr {
    display: block;
    width: 100%;
  }

  .user-table tbody tr {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.8rem;
    padding: 0.7rem 0.8rem;
    border-bottom: 1px solid #eee;
  }

  .user-table td {
    display: contents;
  }

  .user-table td::before {
    content: attr(data-label);
    color: #666;
    font-size: 0.8rem;
  }

  .col-center {
    text-align: left;
  }
}
</style>

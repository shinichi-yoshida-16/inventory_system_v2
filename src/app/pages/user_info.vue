<script setup lang="ts">
// D-10: ユーザ情報画面（FR-13/3-10）
definePageMeta({ middleware: 'auth' })

interface UserSummary {
  allowId: string
  email: string
  isAdmin: boolean
  retiredFlag: boolean
  updatedAt: string
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

onMounted(() => {
  if (isAdmin.value) loadUsers()
})

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
    <h2>許可リスト（管理者機能）</h2>
    <p v-if="listError" style="color: red">{{ listError }}</p>
    <table>
      <thead>
        <tr>
          <th>許可ID</th>
          <th>メールアドレス</th>
          <th>管理者</th>
          <th>退職</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.allowId">
          <td>{{ u.allowId }}</td>
          <td>{{ u.email }}</td>
          <td>{{ u.isAdmin ? '○' : '' }}</td>
          <td>{{ u.retiredFlag ? '○' : '' }}</td>
        </tr>
      </tbody>
    </table>

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

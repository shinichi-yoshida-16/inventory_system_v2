<script setup lang="ts">
// D-02: 在庫一覧画面（FR-02、廃番品目はグレーアウト表示。管理者のみ時差更新ボタン、3-12）
definePageMeta({ middleware: 'auth' })

interface InventoryItem {
  itemId: string
  gtin: string
  itemName: string
  currentStock: number
  threshold: number
  location: string
  discontinuedFlag: boolean
}

const { apiFetch } = useApi()
const { isAdmin } = useAuth()
const items = ref<InventoryItem[]>([])
const loading = ref(true)
const error = ref('')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    items.value = await apiFetch<InventoryItem[]>('/api/inventory')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '取得に失敗しました'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// 管理者: 時差更新
const syncMessage = ref('')
const syncError = ref('')

const handleDeferredSync = async () => {
  syncMessage.value = ''
  syncError.value = ''
  try {
    const result = await apiFetch<{ applied: number; remaining: number }>('/api/deferred-sync', { method: 'POST' })
    syncMessage.value =
      result.remaining === 0
        ? `時差更新が完了しました（適用件数: ${result.applied}）`
        : `一部のみ適用しました（適用: ${result.applied}件、未適用: ${result.remaining}件）。再実施してください`
  } catch (e) {
    syncError.value = e instanceof Error ? e.message : '時差更新に失敗しました'
  }
}
</script>

<template>
  <h1>在庫一覧</h1>
  <button @click="navigateTo('/dashboard')">ダッシュボードに戻る</button>

  <p v-if="loading">読み込み中...</p>
  <p v-if="error" style="color: red">{{ error }}</p>

  <table v-if="!loading && items.length">
    <thead>
      <tr>
        <th>品目ID</th>
        <th>品目名</th>
        <th>現在在庫数</th>
        <th>閾値</th>
        <th>保管場所</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="item in items"
        :key="item.itemId"
        :style="item.discontinuedFlag ? 'color: #999; text-decoration: line-through' : ''"
      >
        <td>{{ item.itemId }}</td>
        <td>{{ item.itemName }}<span v-if="item.discontinuedFlag">（廃番）</span></td>
        <td>{{ item.currentStock }}</td>
        <td>{{ item.threshold }}</td>
        <td>{{ item.location }}</td>
      </tr>
    </tbody>
  </table>
  <p v-else-if="!loading">品目が登録されていません</p>

  <section v-if="isAdmin">
    <h2>時差更新（管理者機能）</h2>
    <p>入出庫の更新に失敗し保留されているデータがある場合、下のボタンで後追い適用します。何もなければ何も行われません。</p>
    <button @click="handleDeferredSync">時差更新を実行</button>
    <p v-if="syncMessage" style="color: green">{{ syncMessage }}</p>
    <p v-if="syncError" style="color: red">{{ syncError }}</p>
  </section>
</template>

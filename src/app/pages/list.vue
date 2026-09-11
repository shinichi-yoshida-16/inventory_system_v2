<script setup lang="ts">
// D-02: 在庫一覧画面（FR-02、廃番品目はグレーアウト表示）
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
</template>

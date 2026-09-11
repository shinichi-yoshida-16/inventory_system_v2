<script setup lang="ts">
// D-05: 閾値設定画面（PCのみ・管理者、FR-08/FR-11、3-8）
definePageMeta({ middleware: 'auth' })

interface InventoryItem {
  itemId: string
  itemName: string
  currentStock: number
  threshold: number
  discontinuedFlag: boolean
}

const { apiFetch } = useApi()

const items = ref<InventoryItem[]>([])
const thresholdInputs = reactive<Record<string, number>>({})
const loading = ref(true)
const message = ref('')
const errorMessage = ref('')

const load = async () => {
  loading.value = true
  try {
    items.value = await apiFetch<InventoryItem[]>('/api/inventory')
    for (const item of items.value) thresholdInputs[item.itemId] = item.threshold
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '取得に失敗しました'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const handleUpdateThresholds = async () => {
  message.value = ''
  errorMessage.value = ''
  try {
    const body = { items: items.value.map((i) => ({ itemId: i.itemId, threshold: thresholdInputs[i.itemId] })) }
    const result = await apiFetch<{ updated: number }>('/api/threshold', { method: 'PUT', body })
    message.value = `${result.updated}件の閾値を更新しました`
    await load()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '更新に失敗しました'
  }
}

const handleToggleDiscontinued = async (item: InventoryItem) => {
  errorMessage.value = ''
  try {
    await apiFetch(`/api/inventory/${item.itemId}/discontinued`, {
      method: 'PUT',
      body: { discontinued: !item.discontinuedFlag },
    })
    await load()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '更新に失敗しました'
  }
}
</script>

<template>
  <h1>閾値設定（管理者）</h1>
  <button @click="navigateTo('/dashboard')">ダッシュボードに戻る</button>

  <p v-if="loading">読み込み中...</p>
  <p v-if="errorMessage" style="color: red">{{ errorMessage }}</p>

  <section v-if="!loading">
    <h2>品目ごとの閾値・廃番設定</h2>
    <table>
      <thead>
        <tr>
          <th>品目ID</th>
          <th>品目名</th>
          <th>現在在庫数</th>
          <th>閾値</th>
          <th>廃番</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.itemId">
          <td>{{ item.itemId }}</td>
          <td>{{ item.itemName }}</td>
          <td>{{ item.currentStock }}</td>
          <td><input v-model.number="thresholdInputs[item.itemId]" type="number" min="0" /></td>
          <td>
            <button @click="handleToggleDiscontinued(item)">
              {{ item.discontinuedFlag ? '廃番解除' : '廃番にする' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <button @click="handleUpdateThresholds">閾値を一括更新</button>
    <p v-if="message" style="color: green">{{ message }}</p>
  </section>
</template>

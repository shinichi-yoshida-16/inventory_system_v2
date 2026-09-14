<script setup lang="ts">
// D-02: 在庫一覧画面（FR-02、廃番品目は一覧に表示しない。管理者のみ時差更新ボタン、3-12）
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

const visibleItems = computed(() => items.value.filter((item) => !item.discontinuedFlag))

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

  <div v-if="!loading && visibleItems.length" class="table-wrap">
    <table class="inventory-table">
      <thead>
        <tr>
          <th>品目ID</th>
          <th>品目名</th>
          <th class="col-num">現在在庫数</th>
          <th class="col-num">閾値</th>
          <th>保管場所</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in visibleItems" :key="item.itemId" :class="{ 'row-low-stock': item.currentStock <= item.threshold }">
          <td data-label="品目ID">{{ item.itemId }}</td>
          <td data-label="品目名">{{ item.itemName }}</td>
          <td class="col-num" data-label="現在在庫数">
            <span class="stock-badge" :class="{ 'stock-badge--low': item.currentStock <= item.threshold }">
              {{ item.currentStock }}
            </span>
          </td>
          <td class="col-num" data-label="閾値">{{ item.threshold }}</td>
          <td data-label="保管場所">{{ item.location }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p v-else-if="!loading">品目が登録されていません</p>

  <section v-if="isAdmin">
    <h2>時差更新（管理者機能）</h2>
    <p>入出庫の更新に失敗し保留されているデータがある場合、下のボタンで後追い適用します。何もなければ何も行われません。</p>
    <button @click="handleDeferredSync">時差更新を実行</button>
    <p v-if="syncMessage" style="color: green">{{ syncMessage }}</p>
    <p v-if="syncError" style="color: red">{{ syncError }}</p>
  </section>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.inventory-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.inventory-table thead th {
  position: sticky;
  top: 0;
  background: #f5f6f8;
  text-align: left;
  padding: 0.6rem 0.8rem;
  border-bottom: 2px solid #ddd;
  white-space: nowrap;
}

.inventory-table td {
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid #eee;
}

.inventory-table tbody tr:nth-child(even) {
  background: #fafafa;
}

.inventory-table tbody tr:hover {
  background: #eef4ff;
}

.inventory-table tr.row-low-stock {
  background: #fff5f5;
}

.inventory-table tr.row-low-stock:hover {
  background: #ffe9e9;
}

.col-num {
  text-align: right;
}

.stock-badge {
  display: inline-block;
  min-width: 2.2em;
  padding: 0.1em 0.6em;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}

.stock-badge--low {
  background: #ffdede;
  color: #b3261e;
  font-weight: bold;
}

/* スマホ幅ではテーブルをCSS Gridのカード表示に切り替える */
@media (max-width: 560px) {
  .inventory-table thead {
    display: none;
  }

  .inventory-table,
  .inventory-table tbody,
  .inventory-table tr {
    display: block;
    width: 100%;
  }

  .inventory-table tbody tr {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.8rem;
    padding: 0.7rem 0.8rem;
    border-bottom: 1px solid #eee;
  }

  .inventory-table td {
    display: contents;
  }

  .inventory-table td::before {
    content: attr(data-label);
    color: #666;
    font-size: 0.8rem;
  }

  .col-num {
    text-align: left;
  }
}
</style>

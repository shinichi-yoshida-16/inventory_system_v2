<script setup lang="ts">
// D-04: QRコード発行・印刷画面（PCのみ、FR-03/FR-04/FR-12、overview.md 4.3、transition.md 5.2）
definePageMeta({ middleware: 'auth' })

import QRCode from 'qrcode'

interface InventoryItem {
  itemId: string
  itemName: string
  discontinuedFlag: boolean
}

const { apiFetch } = useApi()

// 新規登録
const newItemName = ref('')
const newThreshold = ref(0)
const newLocation = ref('')
const registerError = ref('')

// 既存品目からの再発行
const items = ref<InventoryItem[]>([])
const selectedItemId = ref('')

// 発行結果
const qrDataUrl = ref('')
const qrItemId = ref('')
const qrItemName = ref('')

const loadItems = async () => {
  try {
    items.value = await apiFetch<InventoryItem[]>('/api/inventory')
  } catch {
    // 再発行用の一覧取得のみなので、失敗しても新規登録は継続可能
  }
}
const reissuableItems = computed(() => items.value.filter((item) => !item.discontinuedFlag))

onMounted(loadItems)

const generateQr = async (itemId: string, itemName: string) => {
  qrDataUrl.value = await QRCode.toDataURL(itemId, { margin: 4, width: 240 })
  qrItemId.value = itemId
  qrItemName.value = itemName
}

const submitNewRegister = async () => {
  registerError.value = ''
  try {
    const result = await apiFetch<{ itemId: string; currentStock: number }>('/api/scan', {
      method: 'POST',
      body: { type: 'IN', quantity: 1, itemName: newItemName.value, threshold: newThreshold.value, location: newLocation.value },
    })
    await generateQr(result.itemId, newItemName.value)
    newItemName.value = ''
    newThreshold.value = 0
    newLocation.value = ''
    await loadItems()
  } catch (e) {
    registerError.value = e instanceof Error ? e.message : '登録に失敗しました'
  }
}

const handleReissue = async () => {
  const item = items.value.find((i) => i.itemId === selectedItemId.value)
  if (!item) return
  await generateQr(item.itemId, item.itemName)
}

const handlePrint = () => window.print()
</script>

<template>
  <h1 class="no-print">QR発行</h1>
  <button class="no-print" @click="navigateTo('/dashboard')">ダッシュボードに戻る</button>

  <section class="no-print">
    <h2>新規品目登録してQR発行</h2>
    <p>品目名: <input v-model="newItemName" /></p>
    <p>閾値: <input v-model.number="newThreshold" type="number" min="0" /></p>
    <p>保管場所: <input v-model="newLocation" /></p>
    <button @click="submitNewRegister">登録してQR発行</button>
    <p v-if="registerError" style="color: red">{{ registerError }}</p>
  </section>

  <section class="no-print">
    <h2>既存品目のQR再発行</h2>
    <select v-model="selectedItemId">
      <option value="" disabled>品目を選択してください</option>
      <option v-for="item in reissuableItems" :key="item.itemId" :value="item.itemId">
        {{ item.itemId }} - {{ item.itemName }}
      </option>
    </select>
    <button :disabled="!selectedItemId" @click="handleReissue">再発行</button>
  </section>

  <section v-if="qrDataUrl">
    <h2 class="no-print">発行結果</h2>
    <div class="qr-label">
      <img :src="qrDataUrl" alt="QRコード" />
      <p>{{ qrItemId }}</p>
      <p>{{ qrItemName }}</p>
    </div>
    <button class="no-print" @click="handlePrint">印刷</button>
  </section>
</template>

<style scoped>
.qr-label {
  display: inline-block;
  padding: 12px;
  border: 1px solid #999;
  text-align: center;
}
@media print {
  @page {
    size: 91mm 55mm;
    margin: 0;
  }
  .no-print {
    display: none !important;
  }
  .qr-label {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 0;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .qr-label img {
    max-width: 70%;
    height: auto;
  }
  .qr-label p {
    margin: 2px 0;
  }
}
</style>

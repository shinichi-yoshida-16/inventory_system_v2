<script setup lang="ts">
// D-03: コードスキャン画面（スマホのみ、FR-05/FR-06/FR-07/FR-12、transition.md 5.3の状態遷移）
definePageMeta({ middleware: 'auth' })

import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'
import { normalizeScannedCode, type NormalizedCode } from '../utils/itemId'
import type { ApiCallError } from '../composables/useApi'

type ScreenState = 'scanning' | 'confirm' | 'newRegister' | 'complete' | 'error'

const { apiFetch } = useApi()

const state = ref<ScreenState>('scanning')
const videoRef = ref<HTMLVideoElement | null>(null)
const errorMessage = ref('')
const completeMessage = ref('')

let controls: IScannerControls | null = null
let codeReader: BrowserMultiFormatReader | null = null

// 確認画面（登録済み品目）
const currentItemId = ref('')
const currentItemName = ref('')
const currentStock = ref(0)
const scanType = ref<'IN' | 'OUT'>('IN')
const quantity = ref(1)
const confirmError = ref('')

// 新規登録画面
const pendingGtin = ref<string | undefined>(undefined)
const newItemName = ref('')
const newThreshold = ref(0)
const newLocation = ref('')
const newRegisterError = ref('')

function stopScanning() {
  controls?.stop()
  controls = null
}

async function startScanning() {
  errorMessage.value = ''
  state.value = 'scanning'
  await nextTick()
  if (!videoRef.value) return

  if (!codeReader) {
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.DATA_MATRIX,
    ])
    codeReader = new BrowserMultiFormatReader(hints)
  }

  try {
    controls = await codeReader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } } },
      videoRef.value,
      (result) => {
        if (result) handleScanned(result.getText())
      }
    )
  } catch {
    errorMessage.value = 'カメラを起動できませんでした。HTTPS接続・カメラ権限をご確認ください'
    state.value = 'error'
  }
}

async function handleScanned(text: string) {
  stopScanning()

  let code: NormalizedCode
  try {
    code = normalizeScannedCode(text)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '読み取れないコードです'
    state.value = 'error'
    return
  }

  try {
    const item = await apiFetch<{ itemId: string; itemName: string; currentStock: number }>(
      `/api/inventory/${code.value}`
    )
    currentItemId.value = item.itemId
    currentItemName.value = item.itemName
    currentStock.value = item.currentStock
    scanType.value = 'IN'
    quantity.value = 1
    confirmError.value = ''
    state.value = 'confirm'
  } catch (e) {
    const err = e as ApiCallError
    if (err.code === 'ITEM_NOT_FOUND') {
      pendingGtin.value = code.kind === 'gtin' ? code.value : undefined
      newItemName.value = ''
      newThreshold.value = 0
      newLocation.value = ''
      newRegisterError.value = ''
      state.value = 'newRegister'
    } else {
      errorMessage.value = err.message || '読み取りに失敗しました'
      state.value = 'error'
    }
  }
}

async function submitScan() {
  confirmError.value = ''
  try {
    const result = await apiFetch<{ itemId: string; currentStock: number }>('/api/scan', {
      method: 'POST',
      body: { itemId: currentItemId.value, type: scanType.value, quantity: quantity.value },
    })
    completeMessage.value = `${scanType.value === 'IN' ? '入庫' : '出庫'}が完了しました（現在在庫数: ${result.currentStock}）`
    state.value = 'complete'
  } catch (e) {
    const err = e as ApiCallError
    if (err.code === 'LOCK_TIMEOUT' && err.deferred) {
      completeMessage.value = err.message || '時差更新として受け付けました'
      state.value = 'complete'
      return
    }
    if (err.code === 'INSUFFICIENT_STOCK') {
      confirmError.value = err.message || '在庫が不足しています'
      return
    }
    errorMessage.value = err.message || '処理に失敗しました'
    state.value = 'error'
  }
}

async function submitNewRegister() {
  newRegisterError.value = ''
  try {
    const result = await apiFetch<{ itemId: string; currentStock: number }>('/api/scan', {
      method: 'POST',
      body: {
        type: 'IN',
        quantity: 1,
        itemName: newItemName.value,
        threshold: newThreshold.value,
        location: newLocation.value,
        gtin: pendingGtin.value,
      },
    })
    completeMessage.value = `登録が完了しました（品目ID: ${result.itemId}）`
    state.value = 'complete'
  } catch (e) {
    const err = e as ApiCallError
    newRegisterError.value = err.message || '登録に失敗しました'
  }
}

function backToScanning() {
  startScanning()
}

onMounted(startScanning)
onBeforeUnmount(stopScanning)
</script>

<template>
  <h1>バーコード読み込み</h1>
  <button @click="navigateTo('/dashboard')">ダッシュボードに戻る</button>

  <div v-if="state === 'scanning'">
    <video ref="videoRef" style="width: 100%; max-width: 400px" muted playsinline />
    <p>カメラでQR / JAN / GS1 DataMatrixを読み取ってください</p>
  </div>

  <div v-else-if="state === 'confirm'">
    <p>品目ID: {{ currentItemId }}</p>
    <p>品目名: {{ currentItemName }}</p>
    <p>現在在庫数: {{ currentStock }}</p>
    <p>
      <label><input v-model="scanType" type="radio" value="IN" />入庫</label>
      <label><input v-model="scanType" type="radio" value="OUT" />出庫</label>
    </p>
    <p>数量: <input v-model.number="quantity" type="number" min="1" /></p>
    <button @click="submitScan">登録</button>
    <button @click="backToScanning">スキャンに戻る</button>
    <p v-if="confirmError" style="color: red">{{ confirmError }}</p>
  </div>

  <div v-else-if="state === 'newRegister'">
    <p>未登録の品目です。新規登録して入庫します</p>
    <p v-if="pendingGtin">GTIN: {{ pendingGtin }}</p>
    <p>品目名: <input v-model="newItemName" /></p>
    <p>閾値: <input v-model.number="newThreshold" type="number" min="0" /></p>
    <p>保管場所: <input v-model="newLocation" /></p>
    <button @click="submitNewRegister">登録して入庫</button>
    <button @click="backToScanning">スキャンに戻る</button>
    <p v-if="newRegisterError" style="color: red">{{ newRegisterError }}</p>
  </div>

  <div v-else-if="state === 'complete'">
    <p>{{ completeMessage }}</p>
    <button @click="backToScanning">スキャンに戻る</button>
  </div>

  <div v-else-if="state === 'error'">
    <p style="color: red">{{ errorMessage }}</p>
    <button @click="backToScanning">スキャンに戻る</button>
  </div>
</template>

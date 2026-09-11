<script setup lang="ts">
// D-01: ダッシュボード（要件8章、transition.md 3章の端末・権限による導線出し分け）
definePageMeta({ middleware: 'auth' })

const { user, isAdmin } = useAuth()
const { isMobile, isDesktop } = useDevice()
</script>

<template>
  <h1>ダッシュボード画面</h1>
  <p v-if="user">ログイン中: {{ user.email }}<span v-if="isAdmin">（管理者）</span></p>

  <div>
    <button @click="navigateTo('/list')">在庫一覧</button>
    <button v-if="isMobile" @click="navigateTo('/inport_qr')">コードスキャン</button>
    <button v-if="isDesktop" @click="navigateTo('/export_qr')">QRコード発行</button>
    <button v-if="isDesktop && isAdmin" @click="navigateTo('/threshold')">閾値設定</button>
    <button @click="navigateTo('/user_info')">ユーザ情報</button>
  </div>
</template>

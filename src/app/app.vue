<script setup lang="ts">
const { user, isLoggedIn, logout } = useAuth()
const { isLoading } = useLoading()
const handleLogout = async () => {
    await logout()
    await navigateTo('/')
}
</script>

<template>
  <header class="header">
    <h1>在庫管理システム(検証)</h1>
    <div v-if="user">
      <p>ログイン中のメールアドレス: <strong>{{ user?.email }}</strong></p>
      <button @click="handleLogout">ログアウト</button>
    </div>
    <div v-else>
      <p>未ログイン</p>
    </div>
  </header>
  <NuxtPage />
  <footer>
  </footer>
  <div v-if="isLoading" class="loading-overlay">
    <p>処理中...</p>
  </div>
</template>

<style>
body {
  background-color: #eee;
  font-size: 18px;
}

input {
  height: 24px;
}

button {
  padding: 5px 10px;
  margin: 5px;
}

.loading-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: 24px;
  z-index: 1000;
}

@media print {
  .header,
  footer,
  .loading-overlay {
    display: none !important;
  }
}
</style>
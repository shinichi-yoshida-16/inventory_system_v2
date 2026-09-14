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
    </div>
    <div v-else>
      <p>未ログイン</p>
    </div>
    <div class="grid_item">
      <button @click="handleLogout" class="logout_button">ログアウト</button>
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

.header {
  display: grid;
  grid-template-columns: 2fr 1fr;
  align-items: middle;
}

.header > h1 {
  grid-column: 1 / 3;
}

button {
  padding: 5px 10px;
  margin: 5px;
}

.grid_item {
  display: grid;
}

.logout_button {
  align-self: center;
  justify-self: end;
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
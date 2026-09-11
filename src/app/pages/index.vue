<script setup lang="ts">
const { login, isLoggedIn } = useAuth()

const email = ref('')
const password = ref('')
const error = ref<string>('')

if(isLoggedIn.value) navigateTo('/dashboard')

const handleLogin = async() => {
  error.value = ''
  try{
    await login(email.value, password.value)
    await navigateTo('/dashboard')
  }catch(e){
    error.value = e instanceof Error ? e.message : 'ログインに失敗しました'
  }
}
</script>

<template>
  <div>
    <p>登録されているメールアドレスとパスワードを入力し、ログインボタンを押下してください</p>
    <p>ログインID:<input v-model="email" type="email" placeholder="メールアドレス" /></p>
    <p>パスワード:<input v-model="password" type="password" placeholder="パスワード" /></p>
    <button @click="handleLogin">ログイン</button>
    <p v-if="error" style="color: red">{{ error }}</p>
  </div>
</template>

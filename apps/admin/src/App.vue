<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, getToken, setToken } from './api';
import PalettePage from './PalettePage.vue';
import UsersPage from './UsersPage.vue';

interface AdminInfo {
  id: string;
  username: string;
  role: string;
}

const admin = ref<AdminInfo | null>(null);
const form = ref({ username: '', password: '' });
const busy = ref(false);
const tab = ref<'palette' | 'users'>('palette');

onMounted(async () => {
  if (!getToken()) return;
  try {
    admin.value = await api<AdminInfo>('GET', '/admin/me');
  } catch {
    setToken(null);
  }
});

async function login(): Promise<void> {
  busy.value = true;
  try {
    const r = await api<{ accessToken: string; admin: AdminInfo }>('POST', '/admin/login', form.value);
    setToken(r.accessToken);
    admin.value = r.admin;
    form.value.password = '';
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

function logout(): void {
  setToken(null);
  admin.value = null;
}
</script>

<template>
  <div v-if="!admin" class="login">
    <el-card header="拼豆图纸 · 后台登录" style="width: 360px">
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="用户名"><el-input v-model="form.username" autocomplete="username" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="form.password" type="password" autocomplete="current-password" show-password /></el-form-item>
        <el-button type="primary" native-type="submit" :loading="busy" style="width: 100%">登录</el-button>
      </el-form>
      <p class="hint">管理员账号用命令创建：<code>pnpm --filter @pd/server admin:create 用户名</code></p>
    </el-card>
  </div>
  <el-container v-else class="shell">
    <el-header class="head">
      <b>拼豆图纸 · 后台</b>
      <el-menu mode="horizontal" :default-active="tab" :ellipsis="false" class="menu" @select="(k: string) => (tab = k as 'palette' | 'users')">
        <el-menu-item index="palette">色卡</el-menu-item>
        <el-menu-item index="users">用户</el-menu-item>
      </el-menu>
      <span class="who">{{ admin.username }}（{{ admin.role }}）</span>
      <el-button text @click="logout">退出</el-button>
    </el-header>
    <el-main>
      <PalettePage v-if="tab === 'palette'" />
      <UsersPage v-else />
    </el-main>
  </el-container>
</template>

<style>
body {
  margin: 0;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #f7f8f5;
}
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hint {
  font-size: 12px;
  color: #5f6f6b;
}
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fff;
  border-bottom: 1px solid #e0e6e2;
}
.menu {
  flex: 1;
  border-bottom: 0 !important;
}
.who {
  color: #5f6f6b;
  font-size: 13px;
}
</style>

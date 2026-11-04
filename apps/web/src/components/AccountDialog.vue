<script setup lang="ts">
import { computed, ref } from 'vue';
import { changePassword, deleteAccount, login, logout, syncNow, updateNickname } from '../cloud';
import { account } from '../lib/account';
import { ask, notify, state } from '../store';
import Modal from './Modal.vue';

const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const password2 = ref('');
const busy = ref(false);
const error = ref('');
const agreed = ref(false);

const view = ref<'main' | 'password' | 'delete'>('main');
const nickname = ref(account.user?.nickname ?? '');
const oldPw = ref('');
const newPw = ref('');

const syncText = computed(
  () =>
    ({
      idle: '',
      syncing: '正在同步…',
      synced: account.lastSync ? `已同步 · ${new Date(account.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '已同步',
      offline: '连不上云端服务，作品先保存在本机，恢复后自动同步',
      error: '同步出错',
    })[account.sync],
);

async function run(fn: () => Promise<void>): Promise<boolean> {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    busy.value = false;
  }
}

async function submit(): Promise<void> {
  if (mode.value === 'register') {
    if (!agreed.value) return void (error.value = '请先阅读并同意用户协议和隐私政策');
    if (password.value !== password2.value) return void (error.value = '两次输入的密码不一样');
  }
  const ok = await run(() => login(username.value.trim(), password.value, mode.value === 'register'));
  if (ok) {
    password.value = password2.value = '';
    nickname.value = account.user?.nickname ?? '';
    notify(mode.value === 'register' ? '注册成功，作品会自动同步到云端' : '已登录');
  }
}

function openLegal(which: 'privacy' | 'terms'): void {
  state.legal = which;
  state.dialog = 'legal';
}

async function saveNickname(): Promise<void> {
  if (nickname.value.trim() === account.user?.nickname) return;
  if (await run(() => updateNickname(nickname.value.trim()))) notify('昵称已保存');
}

async function savePassword(): Promise<void> {
  if (await run(() => changePassword(oldPw.value, newPw.value))) {
    oldPw.value = newPw.value = '';
    view.value = 'main';
    notify('密码已修改，其他设备需要重新登录');
  }
}

async function removeAccount(): Promise<void> {
  if (!(await ask('注销账号？', '账号、云端作品和历史版本会全部删除，这台设备上属于这个账号的作品也会删除，无法恢复。', '永久注销', true))) return;
  if (await run(() => deleteAccount(oldPw.value))) {
    state.dialog = null;
    notify('账号已注销');
  }
}

async function signOut(): Promise<void> {
  if (await run(logout)) {
    state.dialog = null;
    notify('已退出登录；这个账号的作品在下次登录后显示');
  }
}
</script>

<template>
  <Modal :title="account.user ? '账号' : mode === 'login' ? '登录' : '注册'" :width="420" @close="state.dialog = null">
    <form v-if="!account.user" class="form" @submit.prevent="submit">
      <p class="help">登录后作品会自动保存到云端，换电脑、换浏览器也能接着编辑。不登录也可以照常使用，作品只存在这台设备上。</p>
      <label>用户名<input v-model="username" autocomplete="username" maxlength="32" required placeholder="3~32 位字母、数字或下划线" /></label>
      <label>密码<input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="72" required :placeholder="mode === 'register' ? '至少 8 位' : ''" /></label>
      <label v-if="mode === 'register'">再输一次密码<input v-model="password2" type="password" autocomplete="new-password" maxlength="72" required /></label>
      <label v-if="mode === 'register'" class="check">
        <input v-model="agreed" type="checkbox" />
        <span>我已阅读并同意<a href="#" @click.prevent="openLegal('terms')">用户协议</a>和<a href="#" @click.prevent="openLegal('privacy')">隐私政策</a></span>
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="btn primary" type="submit" :disabled="busy">{{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册' }}</button>
      <button class="btn ghost" type="button" @click="(mode = mode === 'login' ? 'register' : 'login'), (error = '')">
        {{ mode === 'login' ? '没有账号？注册一个' : '已有账号？去登录' }}
      </button>
    </form>

    <div v-else-if="view === 'main'" class="form">
      <p class="who">已登录：<b>{{ account.user.username ?? '微信用户' }}</b></p>
      <label>昵称<input v-model="nickname" maxlength="32" @blur="saveNickname" @keydown.enter="saveNickname" /></label>
      <p class="sync" :class="account.sync" aria-live="polite">{{ syncText }}</p>
      <p v-if="account.message" class="error">{{ account.message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="row">
        <button class="btn secondary" :disabled="account.sync === 'syncing'" @click="syncNow()">立即同步</button>
        <button class="btn secondary" @click="(view = 'password'), (error = '')">{{ account.user.hasPassword ? '修改密码' : '设置密码' }}</button>
        <button class="btn secondary" :disabled="busy" @click="signOut">退出登录</button>
      </div>
      <button class="btn ghost danger" @click="(view = 'delete'), (error = '')">注销账号</button>
    </div>

    <form v-else-if="view === 'password'" class="form" @submit.prevent="savePassword">
      <label v-if="account.user.hasPassword">原密码<input v-model="oldPw" type="password" autocomplete="current-password" maxlength="72" required /></label>
      <label>新密码<input v-model="newPw" type="password" autocomplete="new-password" maxlength="72" required placeholder="至少 8 位" /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="row">
        <button class="btn primary" type="submit" :disabled="busy">保存</button>
        <button class="btn ghost" type="button" @click="view = 'main'">返回</button>
      </div>
    </form>

    <form v-else class="form" @submit.prevent="removeAccount">
      <p class="help">注销后账号、云端作品和历史版本会全部删除，无法恢复。建议先导出需要的图纸。</p>
      <label v-if="account.user.hasPassword">输入密码确认<input v-model="oldPw" type="password" autocomplete="current-password" maxlength="72" required /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="row">
        <button class="btn primary danger-fill" type="submit" :disabled="busy">注销账号</button>
        <button class="btn ghost" type="button" @click="view = 'main'">返回</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  color: var(--ink);
}
label.check {
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}
input:not([type='checkbox']) {
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 16px;
}
.help,
.sync {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.sync.offline,
.sync.error {
  color: var(--warn);
}
.who {
  margin: 0;
}
.error {
  color: var(--error);
  font-size: 13px;
  margin: 0;
}
.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.danger-fill {
  background: var(--error);
  border-color: var(--error);
}
a {
  color: var(--primary);
}
</style>

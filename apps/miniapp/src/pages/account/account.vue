<script setup lang="ts">
import { computed, ref } from 'vue';
import { account, bindWechat, engine, loginWithPassword, loginWithWechat, logout, setCredentials, updateNickname } from '../../lib/cloud';

// 「我的」: sign in (one-tap WeChat, or the web app's username + password), sync status, bind WeChat /
// set a web password, sign out. Signed out, the app works as before (works stay on the phone).

const agreed = ref(false);
const showPwd = ref(false);
const username = ref('');
const password = ref('');
const busy = ref(false);
const credForm = ref(false);
const newName = ref('');
const newPwd = ref('');

const STATUS: Record<string, string> = { idle: '未同步', syncing: '同步中…', synced: '已同步', offline: '离线（联网后自动同步）', error: '同步出错' };
const statusText = computed(() => STATUS[account.status] ?? '');
const who = computed(() => {
  const u = account.user;
  if (!u) return '';
  return u.username ? `网页账号：${u.username}` : '微信账号（还没有网页登录用的用户名）';
});

const toast = (title: string) => uni.showToast({ title, icon: 'none', duration: 2500 });
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Detail = { detail: { value: unknown } };
const onAgree = (e: unknown) => (agreed.value = ((e as Detail).detail.value as string[]).length > 0);
const onInput = (target: typeof username) => (e: unknown) => (target.value = String((e as Detail).detail.value ?? ''));
const onUsername = onInput(username);
const onPassword = onInput(password);
const onNewName = onInput(newName);
const onNewPwd = onInput(newPwd);

function needAgree(): boolean {
  if (agreed.value) return false;
  toast('请先阅读并同意用户协议和隐私政策');
  return true;
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    toast(messageOf(e));
  } finally {
    busy.value = false;
  }
}

const wxLogin = () =>
  run(async () => {
    if (needAgree()) return;
    const r = await loginWithWechat();
    toast(r.created ? '已用微信创建账号并登录' : '已登录');
  });

const pwdLogin = () =>
  run(async () => {
    if (needAgree()) return;
    if (!username.value.trim() || !password.value) return toast('请输入用户名和密码');
    await loginWithPassword(username.value.trim(), password.value);
    password.value = '';
    toast('已登录');
  });

const bind = () =>
  run(async () => {
    await bindWechat();
    toast('已绑定，以后可以微信一键登录这个账号');
  });

const saveCredentials = () =>
  run(async () => {
    if (!newName.value.trim() || !newPwd.value) return toast('请输入用户名和密码');
    await setCredentials(newName.value.trim(), newPwd.value);
    newPwd.value = '';
    credForm.value = false;
    toast('已设置，网页上可以用这个用户名登录');
  });

const syncNow = () => run(() => engine.syncNow());

function rename() {
  uni.showModal({
    title: '修改昵称',
    editable: true,
    content: account.user?.nickname ?? '',
    success: (r) => {
      const name = String(r.content ?? '').trim();
      if (r.confirm && name) void run(() => updateNickname(name.slice(0, 32)));
    },
  });
}

function signOut() {
  uni.showModal({
    title: '退出登录',
    content: '退出后，这个账号的作品在手机上会隐藏，再次登录后出现。',
    confirmText: '退出',
    success: (r) => {
      if (r.confirm) void run(logout);
    },
  });
}

const openLegal = (doc: 'terms' | 'privacy') => uni.navigateTo({ url: `/pages/legal/legal?doc=${doc}` });
</script>

<template>
  <view class="page">
    <template v-if="!account.user">
      <view class="card">
        <view class="card-title">登录后作品自动保存到云端</view>
        <view class="muted">换手机、或在网页上登录同一个账号，都能看到和接着改。不登录也能用，作品只保存在这台手机上。</view>
      </view>

      <checkbox-group class="agree" @change="onAgree">
        <label class="agree-row">
          <checkbox value="yes" :checked="agreed" color="#0f766e" />
          <text>我已阅读并同意</text>
          <text class="link" @tap.stop="openLegal('terms')">《用户协议》</text>
          <text>和</text>
          <text class="link" @tap.stop="openLegal('privacy')">《隐私政策》</text>
        </label>
      </checkbox-group>

      <button class="btn btn-primary btn-wx" :loading="busy" :disabled="busy" @tap="wxLogin">微信一键登录</button>
      <view class="link center" @tap="showPwd = !showPwd">{{ showPwd ? '收起' : '已有网页账号？用用户名和密码登录' }}</view>

      <view v-if="showPwd" class="card form">
        <input class="input in-user" :value="username" placeholder="用户名" maxlength="32" @input="onUsername" />
        <input class="input in-pwd" :value="password" placeholder="密码" password maxlength="72" @input="onPassword" />
        <button class="btn btn-pwd-login" :disabled="busy" @tap="pwdLogin">登录</button>
        <view class="muted">登录后可以「绑定微信」，以后直接一键登录这个账号。</view>
      </view>
    </template>

    <template v-else>
      <view class="card">
        <view class="row">
          <view>
            <view class="nick">{{ account.user.nickname || '拼豆用户' }}</view>
            <view class="muted who">{{ who }}</view>
          </view>
          <view class="link" @tap="rename">改昵称</view>
        </view>
        <view class="row sync">
          <view>
            <view class="status">{{ statusText }}</view>
            <view v-if="account.message" class="muted msg">{{ account.message }}</view>
          </view>
          <button size="mini" class="act-sync" :disabled="busy || account.status === 'syncing'" @tap="syncNow">立即同步</button>
        </view>
      </view>

      <view class="card">
        <view v-if="!account.user.hasWechat" class="row">
          <view>
            <view>绑定微信</view>
            <view class="muted">以后在小程序里一键登录这个账号</view>
          </view>
          <button size="mini" class="act-bind" :disabled="busy" @tap="bind">绑定</button>
        </view>
        <view v-else class="row">
          <view>微信</view>
          <view class="muted">已绑定</view>
        </view>

        <template v-if="!account.user.hasPassword">
          <view class="row">
            <view>
              <view>网页登录</view>
              <view class="muted">设置用户名和密码后，可以在网页上登录这个账号</view>
            </view>
            <button size="mini" class="act-cred" @tap="credForm = !credForm">{{ credForm ? '收起' : '设置' }}</button>
          </view>
          <view v-if="credForm" class="form">
            <input class="input in-new-user" :value="newName" placeholder="用户名（3~32 位字母、数字或下划线）" maxlength="32" @input="onNewName" />
            <input class="input in-new-pwd" :value="newPwd" placeholder="密码（至少 8 位）" password maxlength="72" @input="onNewPwd" />
            <button class="btn btn-cred-save" :disabled="busy" @tap="saveCredentials">保存</button>
          </view>
        </template>
      </view>

      <button class="btn btn-logout" :disabled="busy" @tap="signOut">退出登录</button>
    </template>

    <view v-if="!account.user && account.message" class="muted center msg">{{ account.message }}</view>
    <view class="legal muted center">
      <text class="link" @tap="openLegal('terms')">用户协议</text> · <text class="link" @tap="openLegal('privacy')">隐私政策</text>
    </view>
  </view>
</template>

<style>
.page {
  padding: 32rpx;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
}
.card-title {
  font-weight: 600;
  margin-bottom: 8rpx;
}
.agree {
  margin: 8rpx 0 16rpx;
  font-size: 26rpx;
}
.agree-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.link {
  color: #0f766e;
}
.center {
  text-align: center;
  margin: 16rpx 0;
}
.form .input {
  background: #f4f6f5;
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
}
/* mini-program buttons center themselves with auto margins */
.row button {
  margin: 0 0 0 16rpx;
  flex-shrink: 0;
}
.row + .row {
  border-top: 1rpx solid #f0f0f0;
}
.nick {
  font-size: 34rpx;
  font-weight: 600;
}
.who,
.msg {
  margin-top: 6rpx;
}
.status {
  font-weight: 600;
}
.legal {
  margin-top: 48rpx;
}
</style>

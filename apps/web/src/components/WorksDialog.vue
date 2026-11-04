<script setup lang="ts">
import { onMounted } from 'vue';
import { account } from '../lib/account';
import { openWork, refreshWorks, removeWork, state } from '../store';
import type { WorkSummary } from '../lib/storage';
import Modal from './Modal.vue';

onMounted(refreshWorks);
function mark(w: WorkSummary): string {
  if (!account.user) return '';
  if (!w.owner) return '仅本机';
  return w.synced ? '已同步' : '待同步';
}
function fmt(t: number): string {
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <Modal title="我的作品" :width="760" @close="state.dialog = null">
    <p v-if="account.user" class="help">作品保存在这台设备上，并自动同步到云端账号「{{ account.user.nickname || account.user.username }}」。标着「仅本机」的是没登录时做的作品，不会上传。</p>
    <p v-else class="help">
      作品只保存在这台设备的浏览器里。清除浏览器数据会删除它们，重要作品请导出图纸。<a href="#" @click.prevent="state.dialog = 'account'">登录</a>后可以保存到云端。
    </p>
    <p v-if="!state.works.length" class="empty">还没有作品。</p>
    <ul class="grid">
      <li v-for="w in state.works" :key="w.id" :class="{ cur: w.id === state.workId }">
        <img :src="w.thumb" alt="" />
        <span class="name">{{ w.name }}</span>
        <span class="time num">{{ fmt(w.updatedAt) }}<span v-if="mark(w)" class="mark"> · {{ mark(w) }}</span></span>
        <div class="row">
          <button class="btn secondary" @click="openWork(w.id)">{{ w.id === state.workId ? '正在编辑' : '打开' }}</button>
          <button class="btn ghost danger" :aria-label="`删除 ${w.name}`" @click="removeWork(w.id, w.name)">删除</button>
        </div>
      </li>
    </ul>
  </Modal>
</template>

<style scoped>
.help a {
  color: var(--primary);
}
.mark {
  color: var(--muted);
}
.help {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 12px;
}
.grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
li.cur {
  border-color: var(--primary);
}
img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--canvas);
  border-radius: 8px;
}
.name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time {
  color: var(--muted);
  font-size: 12px;
}
.row {
  display: flex;
  gap: 4px;
}
.row .btn {
  flex: 1;
  height: 36px;
}
.empty {
  color: var(--muted);
}
</style>

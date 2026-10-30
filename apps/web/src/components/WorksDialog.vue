<script setup lang="ts">
import { onMounted } from 'vue';
import { openWork, refreshWorks, removeWork, state } from '../store';
import Modal from './Modal.vue';

onMounted(refreshWorks);
function fmt(t: number): string {
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <Modal title="我的作品" :width="760" @close="state.dialog = null">
    <p class="help">作品只保存在这台设备的浏览器里。清除浏览器数据会删除它们，重要作品请导出图纸。</p>
    <p v-if="!state.works.length" class="empty">还没有作品。</p>
    <ul class="grid">
      <li v-for="w in state.works" :key="w.id" :class="{ cur: w.id === state.workId }">
        <img :src="w.thumb" alt="" />
        <span class="name">{{ w.name }}</span>
        <span class="time num">{{ fmt(w.updatedAt) }}</span>
        <div class="row">
          <button class="btn secondary" @click="openWork(w.id)">{{ w.id === state.workId ? '正在编辑' : '打开' }}</button>
          <button class="btn ghost danger" :aria-label="`删除 ${w.name}`" @click="removeWork(w.id, w.name)">删除</button>
        </div>
      </li>
    </ul>
  </Modal>
</template>

<style scoped>
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

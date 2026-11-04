<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { openWork, refreshWorks, removeWork, startMaker, state } from '../store';

const emit = defineEmits<{ pick: [File | undefined] }>();
const over = ref(false);

onMounted(refreshWorks);

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  emit('pick', input.files?.[0]);
  input.value = ''; // picking the same file again must fire change
}
function onDrop(e: DragEvent): void {
  over.value = false;
  emit('pick', e.dataTransfer?.files?.[0]);
}
function fmt(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="home">
    <h1>把喜欢的图片变成拼豆图纸</h1>
    <label class="drop" :class="{ over }" @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop">
      <input type="file" accept="image/*" @change="onFile" />
      <span class="btn primary big">选择图片</span>
      <span class="sub">或把图片拖到这里 · JPG、PNG、WebP，最大 30MB</span>
      <span class="sub">图片只在这台设备上处理，不会上传</span>
    </label>
    <div class="makers">
      <button class="maker" @click="startMaker('text')">
        <span class="t">文字转图纸</span>
        <span class="sub">名字、短句，可加描边和背景</span>
      </button>
      <button class="maker" @click="startMaker('qr')">
        <span class="t">二维码转图纸</span>
        <span class="sub">网址或文字，拼好能扫；也能识别二维码图片</span>
      </button>
    </div>
    <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>

    <section v-if="state.works.length" class="recent">
      <h2>我的作品</h2>
      <ul>
        <li v-for="w in state.works.slice(0, 8)" :key="w.id">
          <img :src="w.thumb" alt="" />
          <div class="meta">
            <span class="name">{{ w.name }}</span>
            <span class="time num">{{ fmt(w.updatedAt) }}</span>
          </div>
          <button class="btn secondary" @click="openWork(w.id)">继续编辑</button>
          <button class="btn ghost danger" :aria-label="`删除 ${w.name}`" @click="removeWork(w.id, w.name)">删除</button>
        </li>
      </ul>
      <button v-if="state.works.length > 8" class="btn ghost" @click="state.dialog = 'works'">查看全部 {{ state.works.length }} 个作品</button>
    </section>
    <footer class="site-foot">
      <a href="#" @click.prevent="(state.legal = 'terms'), (state.dialog = 'legal')">用户协议</a>
      <a href="#" @click.prevent="(state.legal = 'privacy'), (state.dialog = 'legal')">隐私政策</a>
      <a href="https://github.com/LiuMR-del/pd" target="_blank" rel="noopener">源码（AGPL-3.0）</a>
    </footer>
  </div>
</template>

<style scoped>
.site-foot {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 24px 0 8px;
  font-size: 13px;
}
.site-foot a {
  color: var(--muted);
}
.home {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 16px 64px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
h1 {
  font-size: 24px;
  margin: 0;
}
.drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 16px;
  border: 2px dashed var(--border);
  border-radius: 16px;
  background: var(--panel);
  cursor: pointer;
  text-align: center;
}
.drop.over {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.drop input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.big {
  height: 48px;
  padding: 0 28px;
  font-size: 16px;
}
.sub {
  color: var(--muted);
  font-size: 14px;
}
.makers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.maker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  text-align: left;
}
.maker:hover {
  border-color: var(--primary);
}
.maker .t {
  font-weight: 700;
  color: var(--primary);
}
@media (max-width: 480px) {
  .makers {
    grid-template-columns: 1fr;
  }
}
.recent h2 {
  font-size: 16px;
  margin: 0 0 8px;
}
.recent ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.recent li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.recent img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  background: var(--canvas);
  border-radius: 8px;
}
.meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time {
  color: var(--muted);
  font-size: 13px;
}
.error {
  color: var(--error);
  margin: 0;
}
</style>

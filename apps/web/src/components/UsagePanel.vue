<script setup lang="ts">
import { computed } from 'vue';
import { usageText } from '@pd/render';
import { notify, state, totalBeads, usage } from '../store';

const list = computed(() => usage());
/** Codes used by more than one color (data issue in some brands, e.g. 漫漫 S4). */
const dupKeys = computed(() => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const u of list.value) (seen.has(u.key) ? dup : seen).add(u.key);
  return dup;
});
const total = computed(() => totalBeads());

function toggleHighlight(i: number): void {
  state.highlight = state.highlight === i ? null : i;
}
function useColor(i: number): void {
  state.currentColor = i;
  if (state.tool === 'move' || state.tool === 'picker') state.tool = 'pen';
  notify(`当前颜色：${state.doc!.palette[i].key}`);
}
async function copy(): Promise<void> {
  if (!state.doc) return;
  try {
    await navigator.clipboard.writeText(usageText(state.doc));
    notify('用量清单已复制');
  } catch {
    notify('复制失败，请在导出里下载图片');
  }
}
</script>

<template>
  <div class="usage">
    <div class="head">
      <span>{{ list.length }} 色 · {{ total.toLocaleString() }} 颗</span>
      <button class="btn ghost small" @click="copy">复制清单</button>
    </div>
    <p class="help">点色号在画布上突出显示；点「用」设为画笔颜色。</p>
    <ul>
      <li v-for="u in list" :key="u.index" :class="{ on: state.highlight === u.index, cur: state.currentColor === u.index }">
        <button class="row" :aria-pressed="state.highlight === u.index" @click="toggleHighlight(u.index)">
          <span class="sw" :style="{ background: u.hex }" />
          <span class="key">{{ u.key }}</span>
          <span v-if="dupKeys.has(u.key)" class="dup" title="这个品牌的色卡数据里，同一色号对应了两种颜色">同号异色 {{ u.hex }}</span>
          <span class="count num">{{ u.count }}</span>
        </button>
        <button class="btn ghost use" :aria-label="`把 ${u.key} 设为当前颜色`" @click="useColor(u.index)">用</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.usage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
.help {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
li {
  display: flex;
  align-items: center;
  border-radius: 10px;
}
li.on {
  background: var(--primary-soft);
}
.row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 8px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  text-align: left;
}
.sw {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgb(0 0 0 / 0.2);
}
.key {
  font-weight: 600;
  min-width: 3.5em;
}
.dup {
  font-size: 12px;
  color: var(--warn);
}
.count {
  margin-left: auto;
  color: var(--muted);
}
li.cur .key::after {
  content: ' · 当前';
  color: var(--primary);
  font-weight: 400;
  font-size: 12px;
}
.use {
  height: 32px;
  width: 40px;
  font-size: 13px;
}
.small {
  height: 32px;
  font-size: 13px;
}
</style>

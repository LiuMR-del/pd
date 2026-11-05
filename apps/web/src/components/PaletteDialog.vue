<script setup lang="ts">
import { computed, ref } from 'vue';
import { getPalette } from '@pd/palettes';
import { tierLabel } from '@pd/app-shared';
import { notify, state } from '../store';
import Modal from './Modal.vue';

const q = ref('');
const brand = computed(() => state.doc?.brand ?? state.settings.brand);
const tier = computed<number | 'all'>(() => {
  const t = state.doc?.tier ?? String(state.settings.tier);
  return t === 'all' ? 'all' : Number(t);
});
const colors = computed(() => {
  const all = getPalette(brand.value, tier.value);
  const k = q.value.trim().toUpperCase();
  return k ? all.filter((c) => c.key.toUpperCase().includes(k)) : all;
});
const used = computed(() => {
  void state.version;
  return new Set(state.doc ? state.doc.palette.map((p) => `${p.key}${p.hex}`) : []);
});

function choose(c: { key: string; hex: string }): void {
  if (!state.editor) return;
  state.currentColor = state.editor.ensureColor(c);
  if (state.tool === 'move' || state.tool === 'picker') state.tool = 'pen';
  state.version++;
  notify(`当前颜色：${c.key}`);
  state.dialog = null;
}
</script>

<template>
  <Modal :title="`选择颜色 · ${brand} ${tierLabel(tier)}`" :width="720" @close="state.dialog = null">
    <input v-model="q" class="search" placeholder="搜索色号，如 A12" aria-label="搜索色号" />
    <p class="help">带圆点的颜色已经用在这张图纸里。</p>
    <div class="grid">
      <button
        v-for="c in colors"
        :key="c.key + c.hex"
        class="chip"
        :class="{ used: used.has(c.key + c.hex) }"
        :aria-label="`${c.key}${used.has(c.key + c.hex) ? '（已使用）' : ''}`"
        @click="choose(c)"
      >
        <span class="sw" :style="{ background: c.hex }" />
        <span class="k">{{ c.key }}</span>
      </button>
      <p v-if="!colors.length" class="help">没有找到这个色号。</p>
    </div>
  </Modal>
</template>

<style scoped>
.search {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 16px;
}
.help {
  color: var(--muted);
  font-size: 13px;
  margin: 8px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}
.chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  position: relative;
}
.chip:hover {
  border-color: var(--primary);
}
.chip.used::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
}
.sw {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgb(0 0 0 / 0.2);
}
.k {
  font-size: 13px;
  font-weight: 600;
}
</style>

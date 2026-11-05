<script setup lang="ts">
import { computed, ref } from 'vue';
import { tierColors } from '../lib/makers';
import { tierLabel } from '@pd/app-shared';
import { answerColor, state } from '../store';
import Modal from './Modal.vue';

const q = ref('');
const req = computed(() => state.colorPick!);
const colors = computed(() => {
  const all = tierColors(state.settings.brand, state.settings.tier);
  const k = q.value.trim().toUpperCase();
  return k ? all.filter((c) => c.key.toUpperCase().includes(k)) : all;
});
</script>

<template>
  <Modal :title="`${req.title} · ${state.settings.brand} ${tierLabel(state.settings.tier)}`" :width="720" @close="answerColor(undefined)">
    <input v-model="q" class="search" placeholder="搜索色号，如 H7" aria-label="搜索色号" />
    <div class="grid">
      <button v-if="req.allowNone" class="chip" :class="{ cur: req.current === null }" aria-label="无" @click="answerColor(null)">
        <span class="sw none" />
        <span class="k">无</span>
      </button>
      <button v-for="c in colors" :key="c.id" class="chip" :class="{ cur: req.current === c.id }" :aria-label="c.key" @click="answerColor(c.id)">
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
  margin-bottom: 10px;
}
.help {
  color: var(--muted);
  font-size: 13px;
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
}
.chip:hover {
  border-color: var(--primary);
}
.chip.cur {
  border: 2px solid var(--primary);
  background: var(--primary-soft);
}
.sw {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgb(0 0 0 / 0.2);
}
.sw.none {
  background: linear-gradient(135deg, transparent 45%, var(--error) 45%, var(--error) 55%, transparent 55%), var(--panel);
}
.k {
  font-size: 13px;
  font-weight: 600;
}
</style>

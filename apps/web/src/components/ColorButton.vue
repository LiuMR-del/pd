<script setup lang="ts">
import { computed } from 'vue';
import { resolveColor, type ColorId } from '../lib/makers';
import { pickColor, state } from '../store';

/** A color setting: shows the bead (or "无") and opens the color picker. `fallback` is what an unset value means. */
const props = withDefaults(defineProps<{ label: string; modelValue: ColorId | null; fallback?: { key: string; hex: string } | null; allowNone?: boolean }>(), { fallback: null, allowNone: false });
const emit = defineEmits<{ 'update:modelValue': [ColorId | null] }>();

const shown = computed(() => resolveColor(props.modelValue, state.settings.brand, state.settings.tier) ?? props.fallback);

async function open(): Promise<void> {
  const id = await pickColor(props.label, resolveColor(props.modelValue, state.settings.brand, state.settings.tier)?.id ?? null, props.allowNone);
  if (id !== undefined) emit('update:modelValue', id);
}
</script>

<template>
  <button class="colorbtn" type="button" :aria-label="`${label}：${shown ? shown.key : '无'}，点击更换`" @click="open">
    <span class="lab">{{ label }}</span>
    <span v-if="shown" class="sw" :style="{ background: shown.hex }" />
    <span v-else class="sw none" />
    <span class="key">{{ shown ? shown.key : '无' }}</span>
  </button>
</template>

<style scoped>
.colorbtn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  min-width: 0;
}
.lab {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.sw {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgb(0 0 0 / 0.2);
}
.sw.none {
  background: linear-gradient(135deg, transparent 45%, var(--error) 45%, var(--error) 55%, transparent 55%), var(--panel);
}
.key {
  font-weight: 600;
  white-space: nowrap;
}
</style>

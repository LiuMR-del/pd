<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ label: string; modelValue: number; min: number; max: number; step?: number; unit?: string }>();
const emit = defineEmits<{ 'update:modelValue': [number] }>();
const text = ref(String(props.modelValue));
const error = ref('');

watch(
  () => props.modelValue,
  (v) => (text.value = String(v)),
);

function commit(v: number): void {
  const n = Math.max(props.min, Math.min(props.max, Math.round(v)));
  error.value = '';
  text.value = String(n);
  if (n !== props.modelValue) emit('update:modelValue', n);
}
function onBlur(): void {
  const n = Number(text.value);
  if (!Number.isFinite(n) || text.value.trim() === '') {
    error.value = `请输入 ${props.min}~${props.max} 之间的数字`;
    return;
  }
  if (n < props.min || n > props.max) error.value = `已调整到 ${props.min}~${props.max} 范围内`;
  commit(n);
}
</script>

<template>
  <div class="numfield">
    <label :for="`nf-${label}`">{{ label }}</label>
    <div class="ctl">
      <button class="btn icon" :aria-label="`${label}减少`" :disabled="modelValue <= min" @click="commit(modelValue - (step ?? 1))">−</button>
      <input :id="`nf-${label}`" v-model="text" inputmode="numeric" class="num" @blur="onBlur" @keydown.enter="onBlur" />
      <button class="btn icon" :aria-label="`${label}增加`" :disabled="modelValue >= max" @click="commit(modelValue + (step ?? 1))">+</button>
      <span v-if="unit" class="unit">{{ unit }}</span>
    </div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.numfield {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 8px;
}
label {
  color: var(--ink);
}
.ctl {
  display: flex;
  align-items: center;
  gap: 4px;
}
input {
  width: 56px;
  height: 40px;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 16px;
}
.unit {
  color: var(--muted);
  width: 1.5em;
}
.err {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--warn);
  font-size: 13px;
}
</style>

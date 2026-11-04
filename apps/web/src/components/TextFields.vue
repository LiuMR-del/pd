<script setup lang="ts">
import { computed } from 'vue';
import { hasCjk, TEXT_READABLE_HEIGHT, type TextAlign } from '@pd/makers';
import { textColors, THICKNESS_LABELS, type TextSettings, type Thickness } from '../lib/makers';
import { state } from '../store';
import ColorButton from './ColorButton.vue';
import NumberField from './NumberField.vue';

const t = computed(() => state.textSettings);
const aligns: { id: TextAlign; label: string }[] = [
  { id: 'left', label: '靠左' },
  { id: 'center', label: '居中' },
  { id: 'right', label: '靠右' },
];
const thicknesses = Object.keys(THICKNESS_LABELS) as Thickness[];
const defaults = computed(() => textColors(t.value, state.settings.brand, state.settings.tier));
const small = computed(() => {
  const min = hasCjk(t.value.text) ? TEXT_READABLE_HEIGHT.cjk : TEXT_READABLE_HEIGHT.latin;
  return t.value.height < min ? min : 0;
});

function set<K extends keyof TextSettings>(k: K, v: TextSettings[K]): void {
  state.textSettings = { ...state.textSettings, [k]: v };
}
</script>

<template>
  <section class="field">
    <label class="label" for="txt-input">文字</label>
    <textarea id="txt-input" :value="t.text" rows="3" maxlength="200" placeholder="输入要拼的文字，可以换行" @input="set('text', ($event.target as HTMLTextAreaElement).value)" />
  </section>

  <section class="field">
    <NumberField label="字高" :model-value="t.height" :min="6" :max="60" unit="格" @update:model-value="set('height', $event)" />
    <p v-if="small" class="help warn">字高小于 {{ small }} 格时笔画容易糊在一起，建议调大。</p>
    <span class="label" id="lbl-thick">笔画</span>
    <div class="seg" role="radiogroup" aria-labelledby="lbl-thick">
      <button v-for="k in thicknesses" :key="k" role="radio" :aria-checked="t.thickness === k" @click="set('thickness', k)">{{ THICKNESS_LABELS[k] }}</button>
    </div>
    <label class="check">
      <input type="checkbox" :checked="t.bold" @change="set('bold', ($event.target as HTMLInputElement).checked)" />
      <span>粗体</span>
    </label>
  </section>

  <section class="field">
    <span class="label" id="lbl-align">对齐（多行时）</span>
    <div class="seg" role="radiogroup" aria-labelledby="lbl-align">
      <button v-for="a in aligns" :key="a.id" role="radio" :aria-checked="t.align === a.id" @click="set('align', a.id)">{{ a.label }}</button>
    </div>
    <NumberField label="字间距" :model-value="t.letterSpacing" :min="0" :max="10" unit="格" @update:model-value="set('letterSpacing', $event)" />
    <NumberField label="行间距" :model-value="t.lineSpacing" :min="0" :max="20" unit="格" @update:model-value="set('lineSpacing', $event)" />
    <NumberField label="四周留边" :model-value="t.margin" :min="0" :max="10" unit="格" @update:model-value="set('margin', $event)" />
  </section>

  <section class="field">
    <span class="label">颜色</span>
    <div class="colors">
      <ColorButton label="文字" :model-value="t.color" :fallback="defaults.color" @update:model-value="set('color', $event)" />
      <ColorButton label="描边" :model-value="t.outline" allow-none @update:model-value="set('outline', $event)" />
      <ColorButton label="背景" :model-value="t.background" allow-none @update:model-value="set('background', $event)" />
    </div>
    <p class="help">背景选「无」时空白处不放豆。字形用的是这台设备的系统字体，换一台设备画出来可能略有不同。</p>
  </section>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.label {
  font-weight: 600;
}
textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  font: inherit;
  font-size: 16px;
  resize: vertical;
}
.colors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.check {
  display: flex;
  gap: 10px;
  align-items: center;
}
.check input {
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
}
.help {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.help.warn {
  color: var(--warn);
}
</style>

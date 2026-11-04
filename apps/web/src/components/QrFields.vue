<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { checkQrColors, qrSize, type QrEcc } from '@pd/makers';
import { decodeImage, toRgba } from '../lib/image';
import { ECC_LABELS, qrColors, scanQrImage, type QrSettings } from '../lib/makers';
import { notify, state, workToken } from '../store';
import ColorButton from './ColorButton.vue';

const q = computed(() => state.qrSettings);
const eccs = Object.keys(ECC_LABELS) as QrEcc[];
const colors = computed(() => qrColors(q.value, state.settings.brand, state.settings.tier));
const check = computed(() => checkQrColors(colors.value.dark, colors.value.light, q.value.fillLight));
const size = computed(() => (q.value.text ? qrSize(q.value.text, q.value.ecc, q.value.quietZone) : null));
const scanning = ref(false);
const scanError = ref('');
let alive = true;
onBeforeUnmount(() => (alive = false));

function set<K extends keyof QrSettings>(k: K, v: QrSettings[K]): void {
  state.qrSettings = { ...state.qrSettings, [k]: v };
}

async function onScan(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  scanError.value = '';
  scanning.value = true;
  // the user may open another work while the image is being read
  const token = workToken();
  try {
    const img = await decodeImage(file, file.name);
    const text = await scanQrImage(toRgba(img, null));
    if (!alive || token !== workToken()) return;
    if (text) {
      set('text', text);
      notify('已识别二维码内容');
    } else scanError.value = '没有在图片里找到二维码。请换一张更清楚的截图；小程序码（圆形）不是二维码，识别不了。';
  } catch (err) {
    scanError.value = err instanceof Error ? err.message : String(err);
  } finally {
    scanning.value = false;
  }
}
</script>

<template>
  <section class="field">
    <label class="label" for="qr-input">二维码内容</label>
    <textarea id="qr-input" :value="q.text" rows="3" maxlength="3000" placeholder="网址或文字，例如 https://…" @input="set('text', ($event.target as HTMLTextAreaElement).value)" />
    <label class="btn secondary file" :aria-disabled="scanning">
      {{ scanning ? '正在识别…' : '从二维码图片识别' }}
      <input type="file" accept="image/*" :disabled="scanning" @change="onScan" />
    </label>
    <p v-if="scanError" class="help err" role="alert">{{ scanError }}</p>
    <p v-else-if="q.text && size === null" class="help err">内容太长，放不进二维码。</p>
    <p v-else-if="size" class="help">图纸 {{ size }} × {{ size }} 格（含四周空白）。</p>
  </section>

  <section class="field">
    <span class="label" id="lbl-ecc">纠错等级</span>
    <div class="seg" role="radiogroup" aria-labelledby="lbl-ecc">
      <button v-for="e in eccs" :key="e" role="radio" :aria-checked="q.ecc === e" @click="set('ecc', e)">{{ ECC_LABELS[e] }}</button>
    </div>
    <p class="help">等级越高，拼错几颗或局部被挡住也能扫出来，但图纸会更大。</p>
    <span class="label" id="lbl-quiet">四周空白</span>
    <div class="seg" role="radiogroup" aria-labelledby="lbl-quiet">
      <button v-for="n in [2, 3, 4]" :key="n" role="radio" :aria-checked="q.quietZone === n" @click="set('quietZone', n)">{{ n }} 格</button>
    </div>
    <p class="help">标准要求 4 格；大多数手机 2 格也能扫。</p>
  </section>

  <section class="field">
    <span class="label">颜色</span>
    <div class="colors">
      <ColorButton label="深色" :model-value="q.dark" :fallback="colors.dark" @update:model-value="set('dark', $event)" />
      <ColorButton label="浅色" :model-value="q.light" :fallback="colors.light" @update:model-value="set('light', $event)" />
    </div>
    <label class="check">
      <input type="checkbox" :checked="!q.fillLight" @change="set('fillLight', !($event.target as HTMLInputElement).checked)" />
      <span>浅色格不放豆（放在白色豆板上拼，更省豆）</span>
    </label>
    <p v-if="!check.ok" class="help err" role="alert">
      {{ check.reason === 'same-color' ? '深色和浅色不能是同一种豆子。' : check.reason === 'inverted' ? '深色要比浅色深：反色二维码很多手机扫不出。' : `深浅对比度 ${check.contrast.toFixed(1)}，至少要 4.5，扫不出来，请换颜色。` }}
    </p>
    <p v-else class="help">深浅对比度 {{ check.contrast.toFixed(1) }}，可以扫。拼好后如果修改了格子，可能就扫不出来了。</p>
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
  word-break: break-all;
}
.file {
  align-self: flex-start;
}
.file input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.colors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  line-height: 1.4;
}
.check input {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
  flex: none;
}
.help {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.help.err {
  color: var(--error);
}
</style>

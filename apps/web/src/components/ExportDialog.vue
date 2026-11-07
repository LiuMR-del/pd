<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { layoutSheet, usageText } from '@pd/render';
import { canvasToBlob, downloadBlob } from '../lib/image';
import { notify, state } from '../store';
import Modal from './Modal.vue';

const mirror = ref(false);
const showCodes = ref(true);
// 24 px cells gave 8 px codes, too blurry to read when zoomed in; 40 px is the default now
const cellSize = ref(40);
const busy = ref(false);
const preview = ref<HTMLCanvasElement | null>(null);

/** Keep exports under ~16M pixels: iOS Safari refuses larger canvases. */
const MAX_PIXELS = 16_000_000;

const layout = computed(() => {
  const doc = state.doc!;
  void state.version;
  let s = cellSize.value;
  let l = layoutSheet(doc, { cellSize: s, mirror: mirror.value, showCodes: showCodes.value });
  while (l.width * l.height > MAX_PIXELS && s > 8) {
    s -= 2;
    l = layoutSheet(doc, { cellSize: s, mirror: mirror.value, showCodes: showCodes.value });
  }
  return { sheet: l, cell: s };
});
const reduced = computed(() => layout.value.cell < cellSize.value);

function drawPreview(): void {
  const c = preview.value;
  if (!c) return;
  const { sheet } = layout.value;
  const k = Math.min(1, 640 / sheet.width, 480 / sheet.height);
  c.width = Math.round(sheet.width * k);
  c.height = Math.round(sheet.height * k);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  sheet.draw(ctx);
}

onMounted(drawPreview);
watch(layout, drawPreview);

async function download(): Promise<void> {
  const doc = state.doc!;
  busy.value = true;
  try {
    const { sheet } = layout.value;
    const c = document.createElement('canvas');
    c.width = sheet.width;
    c.height = sheet.height;
    sheet.draw(c.getContext('2d')!);
    const blob = await canvasToBlob(c);
    const name = `${doc.name || '拼豆图纸'}-${doc.cols}x${doc.rows}${mirror.value ? '-镜像' : ''}.png`;
    downloadBlob(blob, name);
    notify('已开始下载');
  } catch (e) {
    notify(e instanceof Error ? e.message : '导出失败');
  } finally {
    busy.value = false;
  }
}

async function copyUsage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(usageText(state.doc!));
    notify('用量清单已复制');
  } catch {
    notify('复制失败');
  }
}
</script>

<template>
  <Modal title="导出图纸" :width="760" @close="state.dialog = null">
    <div class="wrap">
      <div class="pv"><canvas ref="preview" aria-label="导出预览" /></div>
      <div class="opts">
        <fieldset>
          <legend>图纸类型</legend>
          <label class="radio"><input v-model="mirror" type="radio" :value="false" /> 正面（照着拼）</label>
          <label class="radio"><input v-model="mirror" type="radio" :value="true" /> 镜像（背面朝上熨烫时用）</label>
        </fieldset>
        <label class="radio"><input v-model="showCodes" type="checkbox" /> 格子里印色号</label>
        <label class="sel">
          每格大小
          <select v-model.number="cellSize">
            <option :value="24">小（24 像素）</option>
            <option :value="40">中（40 像素）</option>
            <option :value="56">大（56 像素，适合打印）</option>
          </select>
        </label>
        <p class="help num">图片 {{ layout.sheet.width }} × {{ layout.sheet.height }} 像素</p>
        <p v-if="reduced" class="help warn">图纸较大，为了能在手机上打开，每格已缩小到 {{ layout.cell }} 像素。</p>
      </div>
    </div>
    <template #footer>
      <button class="btn secondary" @click="copyUsage">复制用量清单</button>
      <button class="btn primary" :disabled="busy" @click="download">{{ busy ? '正在生成…' : '下载 PNG' }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 16px;
}
.pv {
  background: var(--canvas);
  border-radius: 10px;
  padding: 8px;
  display: grid;
  place-items: center;
  min-height: 200px;
}
.pv canvas {
  max-width: 100%;
  height: auto;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
legend {
  font-weight: 600;
  margin-bottom: 4px;
}
.radio {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 32px;
}
.radio input {
  accent-color: var(--primary);
  width: 18px;
  height: 18px;
}
.sel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.help {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.help.warn {
  color: var(--warn);
}
@media (max-width: 767px) {
  .wrap {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { BRANDS, listTiers } from '@pd/palettes';
import { thumbnail } from '../lib/image';
import { SIZE_LABELS, STYLE_LABELS, tierLabel, withSize, type SizeChoice, type Style } from '../lib/settings';
import { cancelGenerate, generate, settingsChanged, state } from '../store';
import NumberField from './NumberField.vue';

const emit = defineEmits<{ export: []; pick: [File | undefined] }>();

const styles = Object.keys(STYLE_LABELS) as Style[];
const sizes = Object.keys(SIZE_LABELS) as Exclude<SizeChoice, 'custom'>[];
const tiers = listTiers();

const s = computed(() => state.settings);
const thumb = computed(() => (state.source ? thumbnail(state.source.canvas, state.source.width, state.source.height, 160) : ''));
const hasResult = computed(() => state.phase === 'result' && !!state.doc);
const changed = computed(() => settingsChanged());
const primaryLabel = computed(() => {
  if (state.generating) return '取消生成';
  if (!hasResult.value) return '生成图纸';
  return changed.value ? '应用并重新生成' : '导出图纸';
});

function onFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  emit('pick', input.files?.[0]);
  input.value = ''; // picking the same file again must fire change
}
function setSize(size: SizeChoice): void {
  state.settings = withSize(state.settings, size);
}
function setLongSide(v: number): void {
  state.settings = { ...state.settings, longSide: v, size: 'custom' };
}
function setMaxColors(v: number): void {
  state.settings = { ...state.settings, maxColors: v, size: 'custom' };
}
function onTier(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  state.settings = { ...state.settings, tier: v === 'all' ? 'all' : Number(v) };
}
function primary(): void {
  if (state.generating) cancelGenerate();
  else if (hasResult.value && !changed.value) emit('export');
  else void generate();
}
</script>

<template>
  <div class="settings">
    <section class="field">
      <div class="label-row">
        <span class="label">图片</span>
        <span v-if="state.crop" class="hint">已裁剪</span>
      </div>
      <div class="image-row">
        <img v-if="thumb" class="thumb" :src="thumb" alt="已上传的图片" />
        <div class="image-actions">
          <label class="btn secondary file">
            更换
            <input type="file" accept="image/*" @change="onFile" />
          </label>
          <button class="btn secondary" :disabled="!state.source" @click="state.dialog = 'crop'">裁剪</button>
        </div>
      </div>
    </section>

    <section class="field">
      <span class="label" id="lbl-style">风格</span>
      <div class="seg" role="radiogroup" aria-labelledby="lbl-style">
        <button v-for="st in styles" :key="st" role="radio" :aria-checked="s.style === st" @click="state.settings = { ...s, style: st }">
          {{ STYLE_LABELS[st] }}
        </button>
      </div>
      <p class="help">卡通：轮廓清楚；照片：过渡更柔和；像素图：按原图像素对齐。</p>
    </section>

    <section class="field">
      <span class="label" id="lbl-size">图纸尺寸</span>
      <div class="seg" role="radiogroup" aria-labelledby="lbl-size">
        <button v-for="sz in sizes" :key="sz" role="radio" :aria-checked="s.size === sz" @click="setSize(sz)">{{ SIZE_LABELS[sz] }}</button>
        <button role="radio" :aria-checked="s.size === 'custom'" @click="setSize('custom')">自定义</button>
      </div>
      <NumberField label="长边格数" :model-value="s.longSide" :min="10" :max="200" :step="2" unit="格" @update:model-value="setLongSide" />
      <NumberField label="最大颜色数" :model-value="s.maxColors" :min="2" :max="60" unit="色" @update:model-value="setMaxColors" />
    </section>

    <section class="field">
      <span class="label">色卡</span>
      <div class="row2">
        <select aria-label="品牌" :value="s.brand" @change="state.settings = { ...s, brand: ($event.target as HTMLSelectElement).value }">
          <option v-for="b in BRANDS" :key="b" :value="b">{{ b }}</option>
        </select>
        <select aria-label="色数档" :value="String(s.tier)" @change="onTier">
          <option v-for="t in tiers" :key="t.id" :value="t.id === 'all' ? 'all' : String(t.size)">{{ tierLabel(t.id === 'all' ? 'all' : t.size) }}</option>
        </select>
      </div>
      <p v-if="s.brand !== 'MARD'" class="help warn">非 MARD 品牌暂按 MARD 色值换算色号，实物颜色可能有偏差。</p>
    </section>

    <section class="field">
      <label class="check">
        <input type="checkbox" :checked="s.removeBackground" @change="state.settings = { ...s, removeBackground: ($event.target as HTMLInputElement).checked }" />
        <span>去掉背景（主体自动撑满图纸）</span>
      </label>
    </section>

    <details class="field advanced">
      <summary>高级设置</summary>
      <label class="check">
        <input type="checkbox" :checked="s.strokeProtect" @change="state.settings = { ...s, strokeProtect: ($event.target as HTMLInputElement).checked }" />
        <span>细线保护（保住描边和小字；照片上若五官线条太重可关闭）</span>
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="s.dither !== null && s.dither > 0"
          @change="state.settings = { ...s, dither: ($event.target as HTMLInputElement).checked ? 0.25 : 0 }"
        />
        <span>抖动（渐变更细腻，但零散单颗更多）</span>
      </label>
      <button v-if="s.dither !== null" class="btn ghost small" @click="state.settings = { ...s, dither: null }">抖动恢复风格默认</button>
    </details>

    <div class="actions">
      <p v-if="hasResult && changed && !state.generating" class="help warn">参数已修改，当前图纸仍是上次的结果。</p>
      <button v-if="hasResult && changed && !state.generating" class="btn secondary" @click="emit('export')">导出上次结果</button>
      <button v-else-if="hasResult && !state.generating" class="btn secondary" @click="generate">重新生成</button>
      <button class="btn primary" :disabled="!state.source && !hasResult" @click="primary">{{ primaryLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.label-row {
  display: flex;
  justify-content: space-between;
}
.label {
  font-weight: 600;
}
.hint {
  color: var(--muted);
  font-size: 13px;
}
.image-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--line);
}
.image-actions {
  display: flex;
  gap: 8px;
}
.file input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
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
.advanced summary {
  cursor: pointer;
  font-weight: 600;
  min-height: 32px;
}
.advanced[open] {
  gap: 12px;
}
.help {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
.help.warn {
  color: var(--warn);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: sticky;
  bottom: 0;
  background: var(--panel);
  padding-top: 8px;
}
.small {
  align-self: flex-start;
  height: 32px;
  font-size: 13px;
}
</style>

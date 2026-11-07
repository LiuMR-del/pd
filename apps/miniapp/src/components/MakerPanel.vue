<script setup lang="ts">
import { ECC_LABELS, qrColors, THICKNESS_LABELS, type QrSettings, type TextSettings, type Thickness } from '@pd/app-shared';
import { checkQrColors, type QrEcc, type TextAlign } from '@pd/makers';
import { computed } from 'vue';
import BeadColorRow from './BeadColorRow.vue';

// Settings of a text or QR pattern (same model as the web app, @pd/app-shared). The brand / kit
// rows come from SettingsPanel (palette-only) right below this panel.
const props = defineProps<{ kind: 'text' | 'qr'; text: TextSettings; qr: QrSettings; brand: string; tier: number | 'all'; disabled?: boolean }>();
const emit = defineEmits<{ 'update:text': [TextSettings]; 'update:qr': [QrSettings] }>();

const thicknesses = Object.keys(THICKNESS_LABELS) as Thickness[];
const aligns: { id: TextAlign; label: string }[] = [
  { id: 'left', label: '靠左' },
  { id: 'center', label: '居中' },
  { id: 'right', label: '靠右' },
];
const eccs = Object.keys(ECC_LABELS) as QrEcc[];

function setText(patch: Partial<TextSettings>) {
  if (!props.disabled) emit('update:text', { ...props.text, ...patch });
}
function setQr(patch: Partial<QrSettings>) {
  if (!props.disabled) emit('update:qr', { ...props.qr, ...patch });
}

// event handlers live here, not in the template: uni's mini-program template compiler should not
// see TypeScript; <switch> / <textarea> events are typed as DOM events by vue-tsc, hence `unknown`
const valueOf = (e: unknown): unknown => (e as { detail: { value: unknown } }).detail.value;
type NumericText = 'height' | 'letterSpacing' | 'lineSpacing' | 'margin';
const onText = (e: unknown) => setText({ text: String(valueOf(e) ?? '') });
const onTextNumber = (key: NumericText, e: unknown) => setText({ [key]: Number(valueOf(e)) } as Partial<TextSettings>);
const onBold = (e: unknown) => setText({ bold: !!valueOf(e) });
const onQrText = (e: unknown) => setQr({ text: String(valueOf(e) ?? '') });
const onQuietZone = (e: unknown) => setQr({ quietZone: Number(valueOf(e)) });
const onFillLight = (e: unknown) => setQr({ fillLight: !!valueOf(e) });

const qrCheck = computed(() => {
  const c = qrColors(props.qr, props.brand, props.tier);
  return checkQrColors(c.dark, c.light, props.qr.fillLight);
});
const qrWarning = computed(() => {
  const r = qrCheck.value.reason;
  if (r === 'same-color') return '深色和浅色是同一种豆子，扫不出来。';
  if (r === 'inverted') return '深色比浅色还浅（反色），很多手机扫不出来，请对调颜色。';
  if (r === 'low-contrast') return `深浅两色对比度只有 ${qrCheck.value.contrast.toFixed(1)}，低于 4.5，可能扫不出来。`;
  return '';
});

function scan() {
  if (props.disabled) return;
  uni.scanCode({
    scanType: ['qrCode'],
    success: (r) => {
      if (r.result) setQr({ text: String(r.result) });
    },
    fail: (err) => {
      if (!/cancel/i.test(String(err?.errMsg ?? ''))) uni.showToast({ title: '没有识别到二维码', icon: 'none' });
    },
  });
}
</script>

<template>
  <view class="panel maker" :class="{ disabled }">
    <template v-if="kind === 'text'">
      <view class="field-label">文字（可以分行）</view>
      <textarea class="input text-input" :value="text.text" :disabled="disabled" maxlength="200" auto-height placeholder="输入要拼的文字" @input="onText" />
      <view class="slider-row">
        <view class="slider-label">字高（格）</view>
        <slider class="slider" :min="6" :max="60" :value="text.height" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onTextNumber('height', $event)" />
      </view>
      <view class="row">
        <view class="label">粗体</view>
        <switch :checked="text.bold" :disabled="disabled" color="#0f766e" @change="onBold" />
      </view>
      <view class="row">
        <view class="label">笔画</view>
        <view class="seg">
          <view v-for="t in thicknesses" :key="t" class="seg-item" :class="{ on: text.thickness === t }" @tap="setText({ thickness: t })">{{ THICKNESS_LABELS[t] }}</view>
        </view>
      </view>
      <view class="row">
        <view class="label">对齐</view>
        <view class="seg">
          <view v-for="a in aligns" :key="a.id" class="seg-item" :class="{ on: text.align === a.id }" @tap="setText({ align: a.id })">{{ a.label }}</view>
        </view>
      </view>
      <view class="slider-row">
        <view class="slider-label">字间距</view>
        <slider class="slider" :min="0" :max="10" :value="text.letterSpacing" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onTextNumber('letterSpacing', $event)" />
      </view>
      <view class="slider-row">
        <view class="slider-label">行间距</view>
        <slider class="slider" :min="0" :max="20" :value="text.lineSpacing" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onTextNumber('lineSpacing', $event)" />
      </view>
      <view class="slider-row">
        <view class="slider-label">四周留白</view>
        <slider class="slider" :min="0" :max="10" :value="text.margin" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onTextNumber('margin', $event)" />
      </view>
      <BeadColorRow label="文字颜色" :model-value="text.color" :brand="brand" :tier="tier" empty-label="自动（最深的颜色）" :disabled="disabled" @update:model-value="setText({ color: $event })" />
      <BeadColorRow label="描边" :model-value="text.outline" :brand="brand" :tier="tier" empty-label="不描边" :disabled="disabled" @update:model-value="setText({ outline: $event })" />
      <BeadColorRow label="背景" :model-value="text.background" :brand="brand" :tier="tier" empty-label="不放豆" :disabled="disabled" @update:model-value="setText({ background: $event })" />
    </template>

    <template v-else>
      <view class="field-label">二维码内容（网址或文字）</view>
      <textarea class="input qr-input" :value="qr.text" :disabled="disabled" maxlength="3000" auto-height placeholder="例如 https://..." @input="onQrText" />
      <button size="mini" class="scan" :disabled="disabled" @tap="scan">扫码识别（可选相册里的二维码图片）</button>
      <view class="row">
        <view class="label">容错</view>
        <view class="seg">
          <view v-for="e in eccs" :key="e" class="seg-item" :class="{ on: qr.ecc === e }" @tap="setQr({ ecc: e })">{{ ECC_LABELS[e] }}</view>
        </view>
      </view>
      <view class="slider-row">
        <view class="slider-label">四周留白</view>
        <slider class="slider" :min="2" :max="4" :value="qr.quietZone" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onQuietZone" />
      </view>
      <view class="row">
        <view class="label">浅色格也放豆</view>
        <switch :checked="qr.fillLight" :disabled="disabled" color="#0f766e" @change="onFillLight" />
      </view>
      <BeadColorRow label="深色" :model-value="qr.dark" :brand="brand" :tier="tier" empty-label="自动（最深的颜色）" :disabled="disabled" @update:model-value="setQr({ dark: $event })" />
      <BeadColorRow v-if="qr.fillLight" label="浅色" :model-value="qr.light" :brand="brand" :tier="tier" empty-label="自动（最浅的颜色）" :disabled="disabled" @update:model-value="setQr({ light: $event })" />
      <view v-if="qrWarning" class="warn">{{ qrWarning }}</view>
      <view class="hint">拼好后建议用手机扫一下确认能识别；容错越高越耐看错、但格子越多。</view>
    </template>
  </view>
</template>

<style>
.panel.maker {
  background: #fff;
  border-radius: 16rpx;
  padding: 16rpx 24rpx;
  margin-bottom: 16rpx;
}
.panel.maker.disabled {
  opacity: 0.6;
}
.maker .field-label {
  font-size: 26rpx;
  color: #555;
  margin: 8rpx 0;
}
.maker .input {
  width: 100%;
  min-height: 80rpx;
  box-sizing: border-box;
  border: 1rpx solid #d0d7d4;
  border-radius: 12rpx;
  padding: 16rpx;
  font-size: 30rpx;
}
.maker .scan {
  margin: 16rpx 0 0;
}
.maker .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.maker .label {
  color: #333;
}
.maker .seg {
  display: flex;
  border: 1rpx solid #d0d7d4;
  border-radius: 12rpx;
  overflow: hidden;
}
.maker .seg-item {
  padding: 12rpx 20rpx;
  font-size: 26rpx;
}
.maker .seg-item + .seg-item {
  border-left: 1rpx solid #d0d7d4;
}
.maker .seg-item.on {
  background: #0f766e;
  color: #fff;
}
.maker .slider-row {
  display: flex;
  align-items: center;
}
.maker .slider-label {
  font-size: 26rpx;
  color: #555;
  width: 140rpx;
  flex-shrink: 0;
}
.maker .slider {
  flex: 1;
}
.maker .warn {
  background: #fff4e5;
  color: #b54708;
  border-radius: 12rpx;
  padding: 12rpx 16rpx;
  margin-top: 12rpx;
  font-size: 24rpx;
}
.maker .hint {
  color: #888;
  font-size: 24rpx;
  margin: 12rpx 0;
}
</style>

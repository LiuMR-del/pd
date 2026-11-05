<script setup lang="ts">
import { SIZE_LABELS, STYLE_LABELS, tierLabel, withSize, type Settings, type SizeChoice, type Style } from '@pd/app-shared';
import { BRANDS, listTiers } from '@pd/palettes';
import { computed } from 'vue';

// Same settings model as the web app (@pd/app-shared), laid out for a phone: segmented choices,
// pickers for brand / kit, sliders only for the custom size.
const props = defineProps<{ modelValue: Settings; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [Settings] }>();

const styles = Object.keys(STYLE_LABELS) as Style[];
const sizes: SizeChoice[] = ['save', 'balanced', 'detail', 'custom'];
const tiers = computed(() => listTiers().map((t) => (t.id === 'all' ? 'all' : t.size)));
const tierLabels = computed(() => tiers.value.map((t) => tierLabel(t)));
const tierIndex = computed(() => Math.max(0, tiers.value.indexOf(props.modelValue.tier)));
const brandIndex = computed(() => Math.max(0, BRANDS.indexOf(props.modelValue.brand)));

function set(patch: Partial<Settings>) {
  if (props.disabled) return;
  emit('update:modelValue', { ...props.modelValue, ...patch });
}

function setSize(size: SizeChoice) {
  if (props.disabled) return;
  emit('update:modelValue', withSize(props.modelValue, size));
}

function sizeLabel(size: SizeChoice): string {
  return size === 'custom' ? '自定义' : SIZE_LABELS[size];
}

type Detail<T> = { detail: { value: T } };
const onBrand = (e: Detail<number | string>) => set({ brand: BRANDS[Number(e.detail.value)] });
const onTier = (e: Detail<number | string>) => set({ tier: tiers.value[Number(e.detail.value)] });
const onLongSide = (e: Detail<number>) => set({ longSide: Number(e.detail.value) });
const onMaxColors = (e: Detail<number>) => set({ maxColors: Number(e.detail.value) });
// vue-tsc types <switch> as the SVG element, whose change event has no `detail`
const switchValue = (e: unknown) => !!(e as Detail<boolean>).detail.value;
const onRemoveBg = (e: unknown) => set({ removeBackground: switchValue(e) });
const onStroke = (e: unknown) => set({ strokeProtect: switchValue(e) });
</script>

<template>
  <view class="panel" :class="{ disabled }">
    <view class="row">
      <view class="label">风格</view>
      <view class="seg">
        <view v-for="s in styles" :key="s" class="seg-item" :class="{ on: modelValue.style === s }" @tap="set({ style: s })">{{ STYLE_LABELS[s] }}</view>
      </view>
    </view>

    <view class="row">
      <view class="label">尺寸</view>
      <view class="seg">
        <view v-for="s in sizes" :key="s" class="seg-item" :class="{ on: modelValue.size === s }" @tap="setSize(s)">{{ sizeLabel(s) }}</view>
      </view>
    </view>
    <view class="hint">长边 {{ modelValue.longSide }} 格 · 最多 {{ modelValue.maxColors }} 色</view>
    <template v-if="modelValue.size === 'custom'">
      <view class="slider-row">
        <view class="slider-label">长边格数</view>
        <slider class="slider" :min="10" :max="200" :step="1" :value="modelValue.longSide" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onLongSide" />
      </view>
      <view class="slider-row">
        <view class="slider-label">最多颜色</view>
        <slider class="slider" :min="2" :max="60" :step="1" :value="modelValue.maxColors" :disabled="disabled" show-value block-size="20" activeColor="#0f766e" @change="onMaxColors" />
      </view>
    </template>

    <picker mode="selector" :range="BRANDS" :value="brandIndex" :disabled="disabled" @change="onBrand">
      <view class="row picker-row">
        <view class="label">品牌</view>
        <view class="value">{{ modelValue.brand }} ›</view>
      </view>
    </picker>
    <picker mode="selector" :range="tierLabels" :value="tierIndex" :disabled="disabled" @change="onTier">
      <view class="row picker-row">
        <view class="label">色号范围</view>
        <view class="value">{{ tierLabel(modelValue.tier) }} ›</view>
      </view>
    </picker>

    <view class="row">
      <view class="label">去掉背景</view>
      <switch :checked="modelValue.removeBackground" :disabled="disabled" color="#0f766e" @change="onRemoveBg" />
    </view>
    <view class="row">
      <view class="label">细线保护</view>
      <switch :checked="modelValue.strokeProtect" :disabled="disabled" color="#0f766e" @change="onStroke" />
    </view>
  </view>
</template>

<style>
.panel {
  background: #fff;
  border-radius: 16rpx;
  padding: 8rpx 24rpx;
}
.panel.disabled {
  opacity: 0.6;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.label {
  color: #333;
  flex-shrink: 0;
  margin-right: 24rpx;
}
.value {
  color: #0f766e;
  text-align: right;
}
.hint {
  color: #888;
  font-size: 24rpx;
  padding: 12rpx 0;
}
.seg {
  display: flex;
  border: 1rpx solid #d0d7d4;
  border-radius: 12rpx;
  overflow: hidden;
}
.seg-item {
  padding: 12rpx 20rpx;
  font-size: 26rpx;
  color: #444;
  white-space: nowrap;
}
.seg-item + .seg-item {
  border-left: 1rpx solid #d0d7d4;
}
.seg-item.on {
  background: #0f766e;
  color: #fff;
}
.slider-row {
  display: flex;
  align-items: center;
}
.slider-label {
  font-size: 26rpx;
  color: #555;
  width: 140rpx;
  flex-shrink: 0;
}
.slider {
  flex: 1;
}
</style>

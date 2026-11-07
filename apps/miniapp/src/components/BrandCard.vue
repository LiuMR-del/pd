<script setup lang="ts">
import { tierLabel } from '@pd/app-shared';
import { planBrandConversion, type ConversionPlan, type PatternDoc } from '@pd/editor-core';
import { BRANDS, getTier, listTiers, paletteData } from '@pd/palettes';
import { computed, ref } from 'vue';

// Switch the pattern to another brand / kit (same logic as the web app's 换品牌 dialog, via
// @pd/editor-core): the same bead only changes code, colors missing from the target kit go to the
// nearest (CIEDE2000) color. Applied as one undo step by the page.
const props = defineProps<{ doc: PatternDoc; version: number }>();
const emit = defineEmits<{ close: []; apply: [ConversionPlan] }>();

const tiers = listTiers().map((t) => (t.id === 'all' ? 'all' : t.size));
const tierLabels = tiers.map((t) => tierLabel(t));
const brand = ref(props.doc.brand);
const tier = ref<number | 'all'>(props.doc.tier === 'all' ? 'all' : Number(props.doc.tier) || 'all');

const plan = computed(() => {
  void props.version;
  return planBrandConversion(props.doc, paletteData.colors, { brand: brand.value, tier: String(tier.value), colorIds: getTier(tier.value).colorIds });
});
const same = computed(() => brand.value === props.doc.brand && String(tier.value) === props.doc.tier);
const approx = computed(() => plan.value.rows.filter((r) => !r.exact).length);
const merged = computed(() => plan.value.rows.length - new Set(plan.value.rows.map((r) => `${r.to.key}${r.to.hex}`)).size);

const valueOf = (e: unknown) => Number((e as { detail: { value: unknown } }).detail.value);
const onBrand = (e: unknown) => (brand.value = BRANDS[valueOf(e)]);
const onTier = (e: unknown) => (tier.value = tiers[valueOf(e)]);
</script>

<template>
  <view class="card">
    <view class="head">
      <view class="title">换品牌 / 色号范围</view>
      <view class="close" @tap="emit('close')">收起</view>
    </view>
    <view class="muted">目标里有同一种豆子的只换色号；没有的换成最接近的颜色。可以撤销。</view>
    <picker mode="selector" :range="BRANDS" :value="BRANDS.indexOf(brand)" @change="onBrand">
      <view class="row">
        <view class="label">换成品牌</view>
        <view class="value">{{ brand }} ›</view>
      </view>
    </picker>
    <picker mode="selector" :range="tierLabels" :value="tiers.indexOf(tier)" @change="onTier">
      <view class="row">
        <view class="label">色号范围</view>
        <view class="value">{{ tierLabel(tier) }} ›</view>
      </view>
    </picker>
    <view v-if="brand !== 'MARD'" class="warn">{{ brand }} 的色值是按 MARD 色卡对应过来的参考值，不是实测，实物颜色可能有偏差。</view>
    <view class="summary">
      {{ plan.rows.length }} 种颜色：{{ plan.rows.length - approx }} 种同色只换色号<text v-if="approx">，{{ approx }} 种换成近似色</text><text v-if="merged">，其中 {{ merged }} 种会和别的颜色合并</text>
    </view>
    <scroll-view scroll-y class="list">
      <view v-for="r in plan.rows" :key="r.index" class="conv" :class="{ approx: !r.exact }">
        <view class="sw" :style="{ background: r.from.hex }" />
        <view class="code">{{ r.from.key }}</view>
        <view class="arrow">→</view>
        <view class="sw" :style="{ background: r.to.hex }" />
        <view class="code">{{ r.to.key }}</view>
        <view class="count">{{ r.count }} 颗</view>
        <view class="note">{{ r.exact ? '同色' : '近似' }}</view>
      </view>
    </scroll-view>
    <button class="btn btn-primary apply" :disabled="same" @tap="emit('apply', plan)">{{ same ? '和现在一样' : '换成这个' }}</button>
  </view>
</template>

<style>
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
}
.head {
  display: flex;
  align-items: center;
  margin-bottom: 8rpx;
}
.title {
  flex: 1;
  font-weight: 600;
}
.close {
  color: #0f766e;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 80rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.label {
  color: #333;
}
.value {
  color: #0f766e;
}
.warn {
  background: #fff4e5;
  color: #b54708;
  border-radius: 12rpx;
  padding: 12rpx 16rpx;
  margin-top: 12rpx;
  font-size: 24rpx;
}
.summary {
  margin: 16rpx 0 8rpx;
  font-size: 26rpx;
}
.list {
  max-height: 40vh;
}
.conv {
  display: flex;
  align-items: center;
  padding: 10rpx 0;
  border-bottom: 1rpx solid #f5f5f5;
  font-size: 26rpx;
}
.conv.approx {
  background: #fff8ef;
}
.conv .sw {
  width: 36rpx;
  height: 36rpx;
  border-radius: 6rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.2);
  margin-right: 8rpx;
}
.conv .code {
  width: 90rpx;
  font-weight: 600;
}
.conv .arrow {
  width: 40rpx;
  color: #888;
}
.conv .count {
  flex: 1;
  text-align: right;
  margin-right: 16rpx;
}
.conv .note {
  width: 60rpx;
  font-size: 22rpx;
  color: #888;
}
.conv.approx .note {
  color: #b54708;
}
.apply {
  margin-top: 16rpx;
}
</style>

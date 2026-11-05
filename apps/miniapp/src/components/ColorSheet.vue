<script setup lang="ts">
import { tierLabel } from '@pd/app-shared';
import { colorUsage, type PaletteEntry, type PatternDoc } from '@pd/editor-core';
import { getPalette } from '@pd/palettes';
import { computed } from 'vue';

// Pick the brush color: colors already in the pattern first, then every color of the pattern's
// brand / kit (picking one of those adds it to the pattern's palette).
// A card in the page flow, not an overlay (the canvas renders above overlays; see UsageSheet).
const props = defineProps<{ doc: PatternDoc; version: number; current: PaletteEntry | null }>();
const emit = defineEmits<{ close: []; pick: [PaletteEntry] }>();

const tier = computed<number | 'all'>(() => (props.doc.tier === 'all' ? 'all' : Number(props.doc.tier) || 'all'));
const used = computed(() => {
  void props.version;
  return colorUsage(props.doc).map((u) => ({ key: u.key, hex: u.hex }));
});
const all = computed(() => {
  try {
    return getPalette(props.doc.brand, tier.value);
  } catch {
    return [];
  }
});
const isCurrent = (c: PaletteEntry) => !!props.current && props.current.key === c.key && props.current.hex.toUpperCase() === c.hex.toUpperCase();
</script>

<template>
  <view class="sheet">
    <view class="head">
      <view class="title">选颜色</view>
      <view class="close" @tap="emit('close')">收起</view>
    </view>
    <scroll-view scroll-y class="list">
      <view class="group">图纸里的颜色（{{ used.length }}）</view>
      <view class="grid">
        <view v-for="c in used" :key="'u' + c.key + c.hex" class="cell" :class="{ on: isCurrent(c) }" @tap="emit('pick', c)">
          <view class="swatch" :style="{ background: c.hex }" />
          <view class="key">{{ c.key }}</view>
        </view>
      </view>
      <view class="group">{{ doc.brand }} {{ tierLabel(tier) }}（{{ all.length }}）</view>
      <view class="grid">
        <view v-for="c in all" :key="'a' + c.key + c.hex" class="cell" :class="{ on: isCurrent(c) }" @tap="emit('pick', c)">
          <view class="swatch" :style="{ background: c.hex }" />
          <view class="key">{{ c.key }}</view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<style>
.sheet {
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
.list {
  max-height: 50vh;
}
.group {
  font-size: 24rpx;
  color: #888;
  margin: 16rpx 0 8rpx;
}
.grid {
  display: flex;
  flex-wrap: wrap;
}
.cell {
  width: 12.5%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8rpx 0;
  border-radius: 10rpx;
}
.cell.on {
  background: #e6f4f1;
}
.swatch {
  width: 56rpx;
  height: 56rpx;
  border-radius: 10rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.2);
}
.key {
  font-size: 20rpx;
  margin-top: 4rpx;
}
</style>

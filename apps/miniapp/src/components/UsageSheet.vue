<script setup lang="ts">
import { beadCount, colorUsage, type PatternDoc } from '@pd/editor-core';
import { usageText } from '@pd/render';
import { computed } from 'vue';

// Bead count per color: highlight a color on the canvas, make it the current color, copy the
// shopping list. `version` changes on every edit so the counts refresh.
// Shown as a card in the page flow, not an overlay: the canvas renders above overlays (it covered
// the top of a bottom sheet in DevTools), and in-flow the highlighted pattern stays visible above.
const props = defineProps<{ doc: PatternDoc; version: number; highlight: number | null; current: number | null }>();
const emit = defineEmits<{ close: []; highlight: [number | null]; current: [number] }>();

const rows = computed(() => {
  void props.version;
  return colorUsage(props.doc);
});
const total = computed(() => {
  void props.version;
  return beadCount(props.doc);
});
/** Codes used by more than one color (a known palette data issue): show the hex so they can be told apart. */
const dupKeys = computed(() => {
  const seen = new Map<string, number>();
  for (const r of rows.value) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
});

function toggleHighlight(index: number) {
  emit('highlight', props.highlight === index ? null : index);
}

function copy() {
  uni.setClipboardData({
    data: usageText(props.doc),
    success: () => uni.showToast({ title: '清单已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
  });
}
</script>

<template>
  <view class="sheet">
    <view class="head">
      <view class="title">用量 · {{ rows.length }} 色 · {{ total }} 颗</view>
      <button size="mini" @tap="copy">复制清单</button>
      <view class="close" @tap="emit('close')">收起</view>
    </view>
    <view class="muted tip">点一行在图纸上高亮这个颜色，再点取消；「用这个色」设为画笔颜色</view>
    <scroll-view scroll-y class="list">
      <view v-for="r in rows" :key="r.index" class="row" :class="{ on: highlight === r.index }" @tap="toggleHighlight(r.index)">
        <view class="swatch" :style="{ background: r.hex }" />
        <view class="key">{{ r.key }}<text v-if="dupKeys.has(r.key)" class="hex"> {{ r.hex }}</text></view>
        <view class="count">{{ r.count }} 颗</view>
        <view class="use" :class="{ active: current === r.index }" @tap.stop="emit('current', r.index)">{{ current === r.index ? '当前色' : '用这个色' }}</view>
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
}
.title {
  flex: 1;
  font-weight: 600;
}
.close {
  margin-left: 24rpx;
  color: #0f766e;
}
.tip {
  margin: 8rpx 0 16rpx;
}
.list {
  max-height: 50vh;
}
.row {
  display: flex;
  align-items: center;
  padding: 16rpx 8rpx;
  border-bottom: 1rpx solid #f0f0f0;
}
.row.on {
  background: #e6f4f1;
}
.swatch {
  width: 48rpx;
  height: 48rpx;
  border-radius: 10rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.2);
  margin-right: 20rpx;
}
.key {
  flex: 1;
  font-weight: 600;
}
.hex {
  font-weight: 400;
  color: #888;
  font-size: 22rpx;
}
.count {
  width: 140rpx;
  text-align: right;
  margin-right: 20rpx;
}
.use {
  font-size: 24rpx;
  color: #0f766e;
  border: 1rpx solid #0f766e;
  border-radius: 8rpx;
  padding: 6rpx 12rpx;
}
.use.active {
  background: #0f766e;
  color: #fff;
}
</style>

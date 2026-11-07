<script setup lang="ts">
import { resolveColor, tierColors, type ColorId } from '@pd/app-shared';
import { computed, ref } from 'vue';

// One color setting of a text / QR pattern: shows the chosen bead (or the automatic / "none" choice)
// and expands a grid of the brand + kit colors to pick from.
const props = defineProps<{ label: string; modelValue: ColorId | null; brand: string; tier: number | 'all'; emptyLabel: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [ColorId | null] }>();

const open = ref(false);
const colors = computed(() => tierColors(props.brand, props.tier));
const chosen = computed(() => resolveColor(props.modelValue, props.brand, props.tier));

function pick(id: ColorId | null) {
  emit('update:modelValue', id);
  open.value = false;
}
</script>

<template>
  <view class="bead-row">
    <view class="head" @tap="!disabled && (open = !open)">
      <view class="label">{{ label }}</view>
      <view class="value">
        <view class="sw" :class="{ none: !chosen }" :style="{ background: chosen ? chosen.hex : '' }" />
        <text>{{ chosen ? chosen.key : emptyLabel }} ›</text>
      </view>
    </view>
    <view v-if="open" class="grid">
      <view class="cell auto" :class="{ on: modelValue === null }" @tap="pick(null)">
        <view class="sw none" />
        <view class="key">{{ emptyLabel }}</view>
      </view>
      <view v-for="c in colors" :key="c.id" class="cell" :class="{ on: modelValue === c.id }" @tap="pick(c.id)">
        <view class="sw" :style="{ background: c.hex }" />
        <view class="key">{{ c.key }}</view>
      </view>
    </view>
  </view>
</template>

<style>
.bead-row {
  border-bottom: 1rpx solid #f0f0f0;
}
.bead-row .head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
}
.bead-row .label {
  color: #333;
}
.bead-row .value {
  display: flex;
  align-items: center;
  color: #0f766e;
}
.bead-row .sw {
  width: 40rpx;
  height: 40rpx;
  border-radius: 8rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.2);
  margin-right: 12rpx;
}
.bead-row .sw.none {
  background: repeating-linear-gradient(45deg, #fff 0 8rpx, #e2e7e4 8rpx 16rpx);
}
.bead-row .grid {
  display: flex;
  flex-wrap: wrap;
  max-height: 520rpx;
  overflow-y: auto;
  padding-bottom: 12rpx;
}
.bead-row .cell {
  width: 12.5%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6rpx 0;
  border-radius: 8rpx;
}
.bead-row .cell.on {
  background: #e6f4f1;
}
.bead-row .cell .sw {
  margin-right: 0;
  width: 52rpx;
  height: 52rpx;
}
.bead-row .key {
  font-size: 20rpx;
  margin-top: 4rpx;
}
</style>

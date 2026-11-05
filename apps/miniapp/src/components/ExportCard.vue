<script setup lang="ts">
import type { PatternDoc } from '@pd/editor-core';
import { computed, ref } from 'vue';
import { askOpenAlbumSetting, exportSize, renderSheet, saveToAlbum } from '../lib/mp-files';

// Export the printable sheet (title, rulers, codes, usage legend) to the photo album.
// A card in the page flow like the other panels (the canvas renders above overlays).
const props = defineProps<{ doc: PatternDoc; version: number }>();
const emit = defineEmits<{ close: [] }>();

const mirror = ref(false);
const showCodes = ref(true);
const busy = ref(false);

const size = computed(() => {
  void props.version;
  return exportSize(props.doc, { mirror: mirror.value, showCodes: showCodes.value });
});

type Detail<T> = { detail: { value: T } };
// vue-tsc types <switch> as the SVG element, whose change event has no `detail`
const onCodes = (e: unknown) => (showCodes.value = !!(e as Detail<boolean>).detail.value);

async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    const path = await renderSheet(props.doc, { mirror: mirror.value, showCodes: showCodes.value });
    const r = await saveToAlbum(path);
    if (r === 'ok') uni.showToast({ title: '已保存到相册', icon: 'success' });
    else if (r === 'denied') askOpenAlbumSetting();
  } catch (e) {
    uni.showModal({ title: '保存失败', content: e instanceof Error ? e.message : String(e), showCancel: false });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <view class="card">
    <view class="head">
      <view class="title">导出图纸</view>
      <view class="close" @tap="emit('close')">收起</view>
    </view>
    <view class="row">
      <view class="label">朝向</view>
      <view class="seg">
        <view class="seg-item" :class="{ on: !mirror }" @tap="mirror = false">正面</view>
        <view class="seg-item" :class="{ on: mirror }" @tap="mirror = true">镜像（背面熨烫用）</view>
      </view>
    </view>
    <view class="row">
      <view class="label">格子里显示色号</view>
      <switch :checked="showCodes" color="#0f766e" @change="onCodes" />
    </view>
    <view class="muted info">图片 {{ size.width }} × {{ size.height }} 像素<text v-if="size.cell < 24">（图纸较大，格子已缩小到 {{ size.cell }} 像素以便手机保存）</text></view>
    <button class="btn btn-primary save" :loading="busy" :disabled="busy" @tap="save">保存到相册</button>
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
}
.label {
  color: #333;
}
.seg {
  display: flex;
  border: 1rpx solid #d0d7d4;
  border-radius: 12rpx;
  overflow: hidden;
}
.seg-item {
  padding: 10rpx 20rpx;
  font-size: 26rpx;
}
.seg-item + .seg-item {
  border-left: 1rpx solid #d0d7d4;
}
.seg-item.on {
  background: #0f766e;
  color: #fff;
}
.info {
  margin: 8rpx 0 16rpx;
}
.save {
  margin: 0;
}
</style>

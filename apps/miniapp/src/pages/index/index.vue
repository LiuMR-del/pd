<script setup lang="ts">
import { onUnload } from '@dcloudio/uni-app';
import { getPalette } from '@pd/palettes';
import { presetOptions } from '@pd/pattern-core';
import { ref } from 'vue';
import { CancelledError } from '../../lib/generator';
import { pickImage } from '../../lib/image';
import { sharedGenerator } from '../../lib/mp-worker';
import { describeResult, makeTestImage } from '../../lib/self-test';

const generator = sharedGenerator();
const running = ref(false);
const report = ref('');

// the worker is shared by all pages: only stop the self-test this page started
onUnload(() => {
  if (running.value) generator.cancel();
});

/** Developer self-test: synthetic image → worker → pattern (default MARD 221 kit, cartoon preset). */
async function selfTest() {
  running.value = true;
  report.value = '';
  const started = Date.now();
  try {
    const result = await generator.generate(makeTestImage(), getPalette('MARD', 221), { ...presetOptions('cartoon', 'balanced'), longSide: 48 });
    report.value = `通过：${describeResult(result, Date.now() - started)}`;
  } catch (e) {
    if (!(e instanceof CancelledError)) report.value = `失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    running.value = false;
  }
}

async function pickAndOpen() {
  try {
    const path = await pickImage();
    if (path) uni.navigateTo({ url: `/pages/editor/editor?src=${encodeURIComponent(path)}` });
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : String(e), icon: 'none' });
  }
}

function openWorks() {
  uni.navigateTo({ url: '/pages/works/works' });
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="title">拼豆图纸</view>
      <view class="muted">图片 / 文字 / 二维码 → 带色号的拼豆图纸</view>
    </view>

    <button class="btn btn-primary" @tap="pickAndOpen">选图片生成</button>
    <button class="btn" disabled>文字转图纸（开发中）</button>
    <button class="btn" disabled>二维码转图纸（开发中）</button>
    <button class="btn" @tap="openWorks">我的作品</button>

    <view class="card">
      <view class="card-title">开发自检</view>
      <view class="muted">用程序画的测试图，在 Worker 里生成图纸（MARD 221 色、卡通、长边 48 格）</view>
      <button class="btn" size="mini" :loading="running" :disabled="running" @tap="selfTest">生成测试图纸</button>
      <view v-if="report" class="report">{{ report }}</view>
    </view>
  </view>
</template>

<style>
.page {
  padding: 32rpx;
}
.hero {
  margin: 24rpx 0 40rpx;
}
.title {
  font-size: 44rpx;
  font-weight: 600;
  margin-bottom: 8rpx;
}
.card {
  margin-top: 48rpx;
  padding: 24rpx;
  background: #fff;
  border-radius: 16rpx;
}
.card-title {
  font-weight: 600;
  margin-bottom: 8rpx;
}
.report {
  margin-top: 8rpx;
  word-break: break-all;
}
</style>

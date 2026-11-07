<script setup lang="ts">
import { onShow, onUnload } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { account, engine, onCloudChange, workDeleted } from '../../lib/cloud';
import { worksStore } from '../../lib/mp-files';
import type { WorkSummary } from '../../lib/works';

// 「我的作品」: works on this phone (signed in: also the account's, synced), newest first. Tap to keep
// editing; 「…」 to rename / delete.
const works = ref<WorkSummary[]>([]);

function refresh() {
  try {
    works.value = worksStore().visible();
  } catch {
    works.value = [];
  }
}

onShow(() => {
  refresh();
  engine.schedule(0);
});
onUnload(onCloudChange(refresh));

/** Sync badge of a work (signed in only). */
function badge(w: WorkSummary): string {
  if (!account.user) return '';
  if (!w.owner) return '仅在手机上';
  if (w.dirty || !w.inCloud) return account.status === 'offline' ? '待同步（离线）' : '待同步';
  return '已同步';
}

function open(w: WorkSummary) {
  uni.navigateTo({ url: `/pages/editor/editor?work=${encodeURIComponent(w.id)}` });
}

function when(t: number): string {
  const d = new Date(t);
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function more(w: WorkSummary) {
  uni.showActionSheet({
    itemList: ['重命名', '删除'],
    success: (r) => {
      if (r.tapIndex === 0) rename(w);
      else if (r.tapIndex === 1) remove(w);
    },
  });
}

function rename(w: WorkSummary) {
  uni.showModal({
    title: '重命名',
    editable: true,
    placeholderText: '作品名称',
    content: w.name,
    success: (r) => {
      const name = String(r.content ?? '').trim().slice(0, 40);
      if (!r.confirm || !name || name === w.name) return;
      try {
        worksStore().rename(w.id, name);
        refresh();
        engine.schedule(500);
      } catch {
        uni.showToast({ title: '重命名失败', icon: 'none' });
      }
    },
  });
}

function remove(w: WorkSummary) {
  uni.showModal({
    title: '删除作品',
    content: w.owner && account.user ? `删除「${w.name}」？云端和其他设备上的也会一起删除，不能恢复。` : `删除「${w.name}」？删除后不能恢复。`,
    confirmText: '删除',
    confirmColor: '#b42318',
    success: (r) => {
      if (!r.confirm) return;
      const was = worksStore().remove(w.id);
      workDeleted(was.owner, w.id, was.revision);
      refresh();
      uni.showToast({ title: '已删除', icon: 'none' });
    },
  });
}
</script>

<template>
  <view class="page">
    <view v-if="!works.length" class="empty">
      <view>还没有作品</view>
      <view class="muted">在首页选一张图片生成图纸，会自动保存到这里</view>
    </view>
    <view v-for="w in works" :key="w.id" class="work" @tap="open(w)">
      <image v-if="w.thumb" class="thumb" :src="w.thumb" mode="aspectFit" />
      <view v-else class="thumb none" />
      <view class="info">
        <view class="name">{{ w.name }}</view>
        <view class="muted">{{ w.cols }}×{{ w.rows }} 格 · {{ w.colors }} 色 · {{ w.beads }} 颗</view>
        <view class="muted">{{ when(w.updatedAt) }}<text v-if="badge(w)" class="badge" :class="{ pending: badge(w) !== '已同步' }"> · {{ badge(w) }}</text></view>
      </view>
      <view class="more" @tap.stop="more(w)">···</view>
    </view>
  </view>
</template>

<style>
.page {
  padding: 24rpx;
}
.empty {
  text-align: center;
  padding: 120rpx 0;
  color: #555;
}
.empty .muted {
  margin-top: 12rpx;
}
.work {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 16rpx;
}
.thumb {
  width: 140rpx;
  height: 140rpx;
  border-radius: 8rpx;
  background: #f4f6f5;
  flex-shrink: 0;
}
.info {
  flex: 1;
  min-width: 0;
  margin: 0 20rpx;
}
.name {
  font-weight: 600;
  margin-bottom: 8rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.badge {
  color: #0f766e;
}
.badge.pending {
  color: #b54708;
}
.more {
  padding: 16rpx;
  color: #888;
  font-size: 32rpx;
}
</style>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';

// User agreement / privacy policy (draft, same content as the web app's LegalDialog, adapted to the
// mini-program: WeChat login and photos kept on the phone).
const SOURCE_URL = 'https://github.com/LiuMR-del/pd';
const doc = ref<'terms' | 'privacy'>('terms');

onLoad((q) => {
  doc.value = (q as Record<string, string> | undefined)?.doc === 'privacy' ? 'privacy' : 'terms';
  uni.setNavigationBarTitle({ title: doc.value === 'privacy' ? '隐私政策' : '用户协议' });
});

function copySource() {
  uni.setClipboardData({ data: SOURCE_URL });
}
</script>

<template>
  <view class="page">
    <view class="draft">草案（2026-11-07），正式上线前需按运营主体和法律意见修订。</view>
    <template v-if="doc === 'privacy'">
      <view class="h">不登录时</view>
      <view class="p">图片转换、编辑、导出都在你的手机上完成。图片和作品只保存在这台手机上的小程序存储里，不会上传。</view>
      <view class="h">登录后我们保存的信息</view>
      <view class="p">· 账号：昵称；用微信登录时保存微信提供的用户标识（openid），不获取你的微信昵称、头像或手机号；设置了网页登录时保存用户名和密码的加密摘要（无法还原成密码）。</view>
      <view class="p">· 作品：图纸数据、作品名、生成参数、裁剪范围，以及用来重新生成的原图。每个作品保留最近 30 个历史版本。</view>
      <view class="p">· 登录记录：登录凭证的摘要、到期时间和设备标识，用于保持登录和让你退出其他设备。</view>
      <view class="p">· 为防止暴力破解，服务器会在内存里临时统计同一 IP 地址的登录次数，不写入数据库。</view>
      <view class="h">用途和共享</view>
      <view class="p">这些信息只用于提供登录、云端保存和同步。我们不出售、不向第三方提供你的信息，不用你的作品训练模型，也不对外展示你的作品。</view>
      <view class="h">删除</view>
      <view class="p">删除作品会同时删除它在云端的数据、历史版本和原图。在网页的「账号」里可以注销账号，会删除账号和全部云端数据。</view>
      <view class="h">联系</view>
      <view class="p">项目源码公开在 <text class="link" @tap="copySource">{{ SOURCE_URL }}</text>（点击复制），问题可以在那里反馈。</view>
    </template>
    <template v-else>
      <view class="h">服务内容</view>
      <view class="p">拼豆图纸是把图片、文字、二维码转换成拼豆图纸的工具，提供编辑、导出和（登录后）云端保存。</view>
      <view class="h">你的内容</view>
      <view class="p">你上传的图片和做出的图纸归你所有。请只上传你有权使用的图片；因上传内容侵犯他人权益产生的责任由上传者承担。</view>
      <view class="h">账号</view>
      <view class="p">请妥善保管密码。发现账号被他人使用时，请在网页上修改密码（会让其他设备退出登录）。</view>
      <view class="h">服务说明</view>
      <view class="p">色号和色值来自公开资料，实物颜色可能有差异，购买豆子前请以实物色卡为准。云端服务可能因维护暂时不可用，作品会先保存在手机上，恢复后自动同步；重要作品建议导出图纸备份。</view>
      <view class="h">开源</view>
      <view class="p">本服务的程序以 GNU AGPL-3.0 开源，源码见 <text class="link" @tap="copySource">{{ SOURCE_URL }}</text>（点击复制）。</view>
    </template>
  </view>
</template>

<style>
.page {
  padding: 32rpx;
  line-height: 1.7;
  font-size: 28rpx;
}
.draft {
  color: #b54708;
  font-size: 24rpx;
}
.h {
  font-weight: 600;
  margin: 28rpx 0 8rpx;
}
.link {
  color: #0f766e;
  word-break: break-all;
}
</style>

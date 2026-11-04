<script setup lang="ts">
import { state } from '../store';
import Modal from './Modal.vue';

const SOURCE_URL = 'https://github.com/LiuMR-del/pd';
</script>

<template>
  <Modal :title="state.legal === 'privacy' ? '隐私政策' : '用户协议'" :width="640" @close="state.dialog = null">
    <div class="doc">
      <p class="draft">草案（2026-11-04），正式上线前需按运营主体和法律意见修订。</p>
      <template v-if="state.legal === 'privacy'">
        <h3>不登录时</h3>
        <p>图片转换、编辑、导出都在你的浏览器里完成。图片和作品只保存在这台设备的浏览器存储里，不会上传。</p>
        <h3>登录后我们保存的信息</h3>
        <ul>
          <li>账号：用户名、昵称、密码的加密摘要（无法还原成密码）。</li>
          <li>作品：图纸数据、作品名、生成参数、裁剪范围，以及用来重新生成的原图（缩小到长边 2048 像素以内）。每个作品保留最近 30 个历史版本。</li>
          <li>登录记录：登录凭证的摘要、到期时间和浏览器标识（User-Agent），用于保持登录和让你退出其他设备。</li>
          <li>为防止暴力破解，服务器会在内存里临时统计同一 IP 地址的登录次数，不写入数据库。</li>
        </ul>
        <h3>用途和共享</h3>
        <p>这些信息只用于提供登录、云端保存和同步。我们不出售、不向第三方提供你的信息，不用你的作品训练模型，也不对外展示你的作品。</p>
        <h3>删除</h3>
        <p>删除作品会同时删除它在云端的数据、历史版本和原图。在「账号」里注销账号，会删除账号和全部云端数据。</p>
        <h3>联系</h3>
        <p>项目源码公开在 <a :href="SOURCE_URL" target="_blank" rel="noopener">{{ SOURCE_URL }}</a>，问题可以在那里反馈。</p>
      </template>
      <template v-else>
        <h3>服务内容</h3>
        <p>拼豆图纸是把图片、文字、二维码转换成拼豆图纸的工具，提供编辑、导出和（登录后）云端保存。</p>
        <h3>你的内容</h3>
        <p>你上传的图片和做出的图纸归你所有。请只上传你有权使用的图片；因上传内容侵犯他人权益产生的责任由上传者承担。</p>
        <h3>账号</h3>
        <p>请妥善保管密码。发现账号被他人使用时，请立即修改密码（会让其他设备退出登录）。</p>
        <h3>服务说明</h3>
        <p>色号和色值来自公开资料，实物颜色可能有差异，购买豆子前请以实物色卡为准。云端服务可能因维护暂时不可用，作品会先保存在本机，恢复后自动同步；重要作品建议导出图纸备份。</p>
        <h3>开源</h3>
        <p>本服务的程序以 GNU AGPL-3.0 开源，源码见 <a :href="SOURCE_URL" target="_blank" rel="noopener">{{ SOURCE_URL }}</a>。</p>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.doc {
  font-size: 14px;
  line-height: 1.7;
}
.draft {
  color: var(--warn);
  font-size: 13px;
  margin-top: 0;
}
h3 {
  font-size: 15px;
  margin: 16px 0 4px;
}
ul {
  padding-left: 20px;
  margin: 0;
}
a {
  color: var(--primary);
  word-break: break-all;
}
</style>

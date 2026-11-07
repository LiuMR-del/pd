<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { initCloud, resume } from './lib/cloud';

onLaunch(() => {
  // palettes come bundled with @pd/palettes (server-side palette sync is not used by the mini-program yet)
  void initCloud();
});

// back in the foreground: pick up changes made on other devices
onShow(() => resume());
</script>

<style>
page {
  background: #f6f6f6;
  color: #222;
  font-size: 28rpx;
}
.btn {
  margin: 16rpx 0;
}
/* vue-tsc types <button> as the HTML element, so the mini-program `type="primary"` is styled by hand */
.btn-primary {
  background: #07c160;
  color: #fff;
}
.muted {
  color: #888;
  font-size: 24rpx;
}
</style>

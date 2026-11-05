<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => {
  // palettes come bundled with @pd/palettes; server-side palette sync is a stage 2 topic for the mini-program
});
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

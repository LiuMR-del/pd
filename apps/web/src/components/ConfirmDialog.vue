<script setup lang="ts">
import { answer, state } from '../store';
import Modal from './Modal.vue';
</script>

<template>
  <Modal v-if="state.confirm" :title="state.confirm.title" :width="440" @close="answer(false)">
    <p class="msg">{{ state.confirm.message }}</p>
    <template #footer>
      <button class="btn secondary" @click="answer(false)">取消</button>
      <button class="btn primary" :class="{ danger: state.confirm.danger }" @click="answer(true)">{{ state.confirm.okText }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.msg {
  margin: 0;
  line-height: 1.6;
}
.btn.primary.danger {
  background: var(--error);
  border-color: var(--error);
}
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { listVersions, restoreVersion, saveVersion, type VersionInfo } from '../cloud';
import { ask, notify, state } from '../store';
import Modal from './Modal.vue';

const versions = ref<VersionInfo[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref('');

const REASONS: Record<VersionInfo['reason'], string> = { auto: '自动保存', manual: '手动保存', backup: '重新生成前', restore: '恢复前' };

async function run(fn: () => Promise<void>): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    loading.value = false;
  }
}

onMounted(() => run(async () => void (versions.value = await listVersions())));

function fmt(t: string): string {
  return new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function save(): Promise<void> {
  return run(async () => {
    versions.value = await saveVersion();
    notify('已存为历史版本');
  });
}

async function restore(v: VersionInfo): Promise<void> {
  if (!(await ask('恢复到这个版本？', `作品会回到 ${fmt(v.createdAt)} 的样子。现在的样子会先存成一个历史版本，之后还能再恢复回来。`, '恢复'))) return;
  await run(async () => {
    await restoreVersion(v.id);
    state.dialog = null;
  });
}
</script>

<template>
  <Modal title="历史版本" :width="520" @close="state.dialog = null">
    <p class="help">云端为每个作品保留最近 30 个版本：新建时、手动保存时、距上一个版本超过 30 分钟的修改，以及恢复之前。</p>
    <p v-if="loading" class="help">正在读取…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ul v-if="versions.length" class="list">
      <li v-for="v in versions" :key="v.id">
        <span class="time num">{{ fmt(v.createdAt) }}</span>
        <span class="name">{{ v.name }}</span>
        <span class="reason">{{ REASONS[v.reason] ?? v.reason }}</span>
        <button class="btn secondary" :disabled="busy" @click="restore(v)">恢复</button>
      </li>
    </ul>
    <template #footer>
      <button class="btn secondary" :disabled="busy || loading" @click="save">把现在的样子存为一个版本</button>
    </template>
  </Modal>
</template>

<style scoped>
.help {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 12px;
}
.error {
  color: var(--error);
  font-size: 13px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
li {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reason,
.time {
  color: var(--muted);
  font-size: 13px;
}
</style>

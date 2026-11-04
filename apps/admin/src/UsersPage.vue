<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from './api';

interface UserRow {
  id: string;
  username: string | null;
  nickname: string;
  wechat: boolean;
  createdAt: string;
  works: number;
}

const q = ref('');
const page = ref(1);
const total = ref(0);
const rows = ref<UserRow[]>([]);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: '20' });
    if (q.value.trim()) params.set('q', q.value.trim());
    const r = await api<{ total: number; items: UserRow[] }>('GET', `/admin/users?${params}`);
    total.value = r.total;
    rows.value = r.items;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
const fmt = (t: string) => new Date(t).toLocaleString('zh-CN');
</script>

<template>
  <div>
    <el-input v-model="q" placeholder="搜用户名或昵称" clearable style="width: 260px; margin-bottom: 12px" @change="(page = 1), load()" />
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="username" label="用户名" />
      <el-table-column prop="nickname" label="昵称" />
      <el-table-column label="微信" width="80"><template #default="{ row }">{{ row.wechat ? '是' : '' }}</template></el-table-column>
      <el-table-column prop="works" label="作品数" width="90" />
      <el-table-column label="注册时间" width="200"><template #default="{ row }">{{ fmt(row.createdAt) }}</template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" layout="total, prev, pager, next" :total="total" :page-size="20" style="margin-top: 12px" @current-change="load" />
  </div>
</template>

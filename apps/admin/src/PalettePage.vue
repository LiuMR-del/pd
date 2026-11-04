<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { PaletteColorEntry, PaletteData } from '@pd/palettes';
import { api } from './api';

interface HistoryRow {
  id: number;
  note: string;
  adminId: string | null;
  createdAt: string;
}

const data = ref<PaletteData | null>(null);
const version = ref(0);
const history = ref<HistoryRow[]>([]);
const dirty = ref(false);
const loading = ref(false);
const saving = ref(false);
const q = ref('');

const editing = ref<{ id: number; hex: string; codes: Record<string, string>; tiers: string[] } | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const r = await api<{ version: number; data: PaletteData; history: HistoryRow[] }>('GET', '/admin/palettes');
    data.value = r.data;
    version.value = r.version;
    history.value = r.history;
    dirty.value = false;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const brands = computed(() => data.value?.brands ?? []);
/** Kit tiers (the "all" tier always contains every color). */
const tiers = computed(() => (data.value?.tiers ?? []).filter((t) => t.id !== 'all').sort((a, b) => a.size - b.size));
const tierOf = computed(() => {
  const m = new Map<number, string[]>();
  for (const t of tiers.value) for (const id of t.colorIds) m.set(id, [...(m.get(id) ?? []), t.id]);
  return m;
});
const rows = computed(() => {
  const s = q.value.trim().toUpperCase();
  const all = data.value?.colors ?? [];
  return s ? all.filter((c) => c.hex.includes(s) || Object.values(c.codes).some((v) => v.toUpperCase() === s || v.toUpperCase().startsWith(s))) : all;
});

function edit(c: PaletteColorEntry): void {
  editing.value = { id: c.id, hex: c.hex, codes: { ...c.codes }, tiers: tierOf.value.get(c.id) ?? [] };
}

function applyEdit(): void {
  const e = editing.value;
  const d = data.value;
  if (!e || !d) return;
  const hex = e.hex.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(hex)) return void ElMessage.error('色值格式：#RRGGBB');
  const c = d.colors[e.id];
  c.hex = hex;
  c.codes = Object.fromEntries(Object.entries(e.codes).map(([k, v]) => [k, v.trim()]));
  for (const t of d.tiers) {
    if (t.id === 'all') continue;
    const has = t.colorIds.includes(e.id);
    const want = e.tiers.includes(t.id);
    if (want && !has) t.colorIds.push(e.id);
    if (!want && has) t.colorIds = t.colorIds.filter((x) => x !== e.id);
    t.size = t.colorIds.length;
  }
  editing.value = null;
  dirty.value = true;
}

async function publish(): Promise<void> {
  if (!data.value) return;
  let note: string;
  try {
    note = (await ElMessageBox.prompt('写一句修改说明（会记录在历史里）', '发布色卡', { inputPattern: /\S/, inputErrorMessage: '请填写说明' })).value;
  } catch {
    return;
  }
  saving.value = true;
  try {
    await api('PUT', '/admin/palettes', { data: data.value, note });
    ElMessage.success('已发布；网页用户刷新页面后生效');
    await load();
  } catch (e) {
    ElMessage.error({ message: (e as Error).message, duration: 8000 });
  } finally {
    saving.value = false;
  }
}

const fmt = (t: string) => new Date(t).toLocaleString('zh-CN');
</script>

<template>
  <div v-loading="loading">
    <div class="bar">
      <el-input v-model="q" placeholder="搜色号或色值" clearable style="width: 220px" />
      <span class="muted">版本 {{ version }} · {{ data?.colors.length ?? 0 }} 色 · 点一行修改</span>
      <span class="spacer" />
      <el-button :disabled="!dirty" @click="load">放弃修改</el-button>
      <el-button type="primary" :disabled="!dirty" :loading="saving" @click="publish">发布</el-button>
    </div>
    <el-alert type="info" :closable="false" style="margin-bottom: 12px" title="色数档的颜色数不能改（网页按颜色数识别色数档）：调整套装成员时请一进一出。" />
    <el-alert v-if="dirty" type="warning" :closable="false" title="有未发布的修改" style="margin-bottom: 12px" />
    <el-table :data="rows" border height="calc(100vh - 330px)" row-key="id" @row-click="edit">
      <el-table-column prop="id" label="编号" width="70" />
      <el-table-column label="颜色" width="130">
        <template #default="{ row }"><span class="swatch" :style="{ background: row.hex }" />{{ row.hex }}</template>
      </el-table-column>
      <el-table-column v-for="b in brands" :key="b" :label="b" width="90">
        <template #default="{ row }">{{ row.codes[b] }}</template>
      </el-table-column>
      <el-table-column label="所在色数档">
        <template #default="{ row }">
          <el-tag v-for="t in tierOf.get(row.id) ?? []" :key="t" size="small" style="margin-right: 4px">{{ t }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
    <h4>发布历史</h4>
    <el-table :data="history" size="small" border>
      <el-table-column prop="id" label="版本" width="70" />
      <el-table-column prop="note" label="说明" />
      <el-table-column label="时间" width="200"><template #default="{ row }">{{ fmt(row.createdAt) }}</template></el-table-column>
    </el-table>

    <el-dialog :model-value="!!editing" :title="`修改颜色 ${editing?.id}`" width="460px" @close="editing = null">
      <el-form v-if="editing" label-width="90px">
        <el-form-item label="色值">
          <el-input v-model="editing.hex" style="width: 140px" /><span class="swatch big" :style="{ background: editing.hex }" />
        </el-form-item>
        <el-form-item v-for="b in brands" :key="b" :label="`${b} 色号`"><el-input v-model="editing.codes[b]" style="width: 140px" /></el-form-item>
        <el-form-item label="色数档">
          <el-checkbox-group v-model="editing.tiers">
            <el-checkbox v-for="t in tiers" :key="t.id" :value="t.id">{{ t.id }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = null">取消</el-button>
        <el-button type="primary" @click="applyEdit">确定（发布前不生效）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.spacer {
  flex: 1;
}
.muted {
  color: #5f6f6b;
  font-size: 13px;
}
.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 1px solid #ccc;
  border-radius: 3px;
  vertical-align: -2px;
  margin-right: 6px;
}
.swatch.big {
  width: 28px;
  height: 28px;
  margin-left: 12px;
}
</style>

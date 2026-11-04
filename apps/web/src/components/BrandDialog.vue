<script setup lang="ts">
import { computed, ref } from 'vue';
import { planBrandConversion } from '@pd/editor-core';
import { BRANDS, getTier, listTiers, paletteData } from '@pd/palettes';
import { tierLabel } from '../lib/settings';
import { convertBrand, notify, state } from '../store';
import Modal from './Modal.vue';

const doc = state.doc!;
const tiers = listTiers();
const brand = ref(doc.brand);
const tier = ref<number | 'all'>(doc.tier === 'all' ? 'all' : Number(doc.tier));

const plan = computed(() => {
  void state.version;
  const t = getTier(tier.value);
  return planBrandConversion(doc, paletteData.colors, { brand: brand.value, tier: String(tier.value), colorIds: t.colorIds });
});
const same = computed(() => brand.value === doc.brand && String(tier.value) === doc.tier);
const approx = computed(() => plan.value.rows.filter((r) => !r.exact));
const merged = computed(() => {
  const n = new Set(plan.value.rows.map((r) => `${r.to.key}${r.to.hex}`)).size;
  return plan.value.rows.length - n;
});

function onTier(e: Event): void {
  const v = (e.target as HTMLSelectElement).value;
  tier.value = v === 'all' ? 'all' : Number(v);
}
function apply(): void {
  const changed = convertBrand(plan.value);
  state.dialog = null;
  notify(changed ? `已换成 ${brand.value} 色号，可以撤销` : '色号没有变化');
}
</script>

<template>
  <Modal title="换品牌 / 色数档" :width="640" @close="state.dialog = null">
    <p class="help">把这张图纸的色号换成另一个品牌或色数档。目标里有同一种豆子的只换色号；没有的换成最接近的颜色。</p>
    <div class="row2">
      <select v-model="brand" aria-label="目标品牌">
        <option v-for="b in BRANDS" :key="b" :value="b">{{ b }}</option>
      </select>
      <select aria-label="目标色数档" :value="String(tier)" @change="onTier">
        <option v-for="t in tiers" :key="t.id" :value="t.id === 'all' ? 'all' : String(t.size)">{{ tierLabel(t.id === 'all' ? 'all' : t.size) }}</option>
      </select>
    </div>
    <p v-if="brand !== 'MARD'" class="help warn">{{ brand }} 的色值是按 MARD 色卡对应过来的参考值，不是实测，实物颜色可能有偏差。</p>
    <p class="summary">
      {{ plan.rows.length }} 种颜色：{{ plan.rows.length - approx.length }} 种同色只换色号<template v-if="approx.length">，<strong>{{ approx.length }} 种换成近似色</strong></template><template v-if="merged">，其中 {{ merged }} 种会和别的颜色合并</template>。
    </p>
    <table>
      <thead>
        <tr><th>原色号</th><th></th><th>新色号</th><th class="n">颗数</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in plan.rows" :key="r.index" :class="{ approx: !r.exact }">
          <td><span class="sw" :style="{ background: r.from.hex }" />{{ r.from.key }}</td>
          <td class="arrow">→</td>
          <td><span class="sw" :style="{ background: r.to.hex }" />{{ r.to.key }}</td>
          <td class="n num">{{ r.count }}</td>
          <td>{{ r.exact ? '同色' : `近似（色差 ${r.deltaE.toFixed(1)}）` }}</td>
        </tr>
      </tbody>
    </table>
    <template #footer>
      <button class="btn ghost" @click="state.dialog = null">取消</button>
      <button class="btn primary" :disabled="same" @click="apply">{{ same ? '已是当前色卡' : `换成 ${brand}` }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.help {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 13px;
}
.help.warn {
  color: var(--warn);
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}
.summary {
  margin: 0 0 8px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  text-align: left;
  color: var(--muted);
  font-weight: 600;
  border-bottom: 1px solid var(--line);
  padding: 6px 4px;
}
td {
  padding: 5px 4px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
tr.approx td {
  background: #fff7ed;
}
.n {
  text-align: right;
}
.arrow {
  color: var(--muted);
}
.sw {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgb(0 0 0 / 0.2);
  vertical-align: -3px;
  margin-right: 6px;
}
</style>

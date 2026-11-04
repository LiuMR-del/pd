<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BrandDialog from './components/BrandDialog.vue';
import CanvasView from './components/CanvasView.vue';
import ColorPickDialog from './components/ColorPickDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import CropDialog from './components/CropDialog.vue';
import ExportDialog from './components/ExportDialog.vue';
import MakerPreview from './components/MakerPreview.vue';
import PaletteDialog from './components/PaletteDialog.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import Toolbar from './components/Toolbar.vue';
import UploadHome from './components/UploadHome.vue';
import UsagePanel from './components/UsagePanel.vue';
import WorksDialog from './components/WorksDialog.vue';
import { KIND_LABELS } from './lib/makers';
import { settingsSummary, tierLabel } from './lib/settings';
import { thumbnail } from './lib/image';
import { flushSave, generate, loadFile, redo, rename, startOver, state, totalBeads, undo, usage, type Tool } from './store';

const tab = ref<'settings' | 'usage'>('settings');
const canvasView = ref<InstanceType<typeof CanvasView> | null>(null);
const editingName = ref(false);

const narrow = window.matchMedia('(max-width: 767px)');
const isNarrow = ref(narrow.matches);
narrow.addEventListener('change', (e) => (isNarrow.value = e.matches));
const saveText = computed(() =>
  isNarrow.value
    ? { idle: '', saving: '保存中', saved: '已保存', error: '保存失败' }[state.saveState]
    : { idle: '', saving: '保存中…', saved: '已保存到本机', error: '本机保存失败，请导出图纸备份' }[state.saveState],
);
const summary = computed(() => {
  void state.version;
  if (!state.doc) return '';
  return `${state.doc.cols} × ${state.doc.rows} 格 · 实际 ${usage().length} 色 · ${totalBeads().toLocaleString()} 颗`;
});
const preview = computed(() => (state.source ? thumbnail(state.source.canvas, state.source.width, state.source.height, 1400) : ''));
const readySummary = computed(() =>
  state.kind === 'image' ? settingsSummary(state.settings) : `${KIND_LABELS[state.kind]}图纸 · ${state.settings.brand} ${tierLabel(state.settings.tier)}`,
);

function pick(file: File | undefined): void {
  if (file) void loadFile(file);
}

function openExport(): void {
  if (state.doc) state.dialog = 'export';
}

const toolKeys: Record<string, Tool> = { v: 'move', b: 'pen', e: 'eraser', i: 'picker', g: 'fill', r: 'replace' };
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null;
  if (state.dialog || state.confirm || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  // keep history operations out of an unfinished pen stroke
  if (mod && state.editor?.stroking) return;
  if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    redo();
  } else if (!mod && !e.altKey && state.phase === 'result' && toolKeys[k]) {
    state.tool = toolKeys[k];
  } else if (!mod && (k === '+' || k === '=')) canvasView.value?.zoomBy(1.25);
  else if (!mod && k === '-') canvasView.value?.zoomBy(0.8);
  else if (!mod && k === '0') canvasView.value?.fit();
}

function onUnload(): void {
  void flushSave();
}
/** Mobile browsers may kill a hidden page without pagehide: save as soon as it is hidden. */
function onVisibility(): void {
  if (document.visibilityState === 'hidden') void flushSave();
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', onUnload);
  document.addEventListener('visibilitychange', onVisibility);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pagehide', onUnload);
  document.removeEventListener('visibilitychange', onVisibility);
});

function commitName(e: Event): void {
  editingName.value = false;
  rename((e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="app">
    <header class="top">
      <button class="brand" aria-label="拼豆图纸首页" @click="startOver">
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>拼豆图纸</span>
      </button>
      <template v-if="state.doc">
        <input
          v-if="editingName"
          class="name-input"
          :value="state.doc.name"
          aria-label="作品名称"
          autofocus
          maxlength="40"
          @blur="commitName"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <button v-else class="name" title="点击重命名" @click="editingName = true">{{ state.doc.name }}</button>
      </template>
      <span class="save" :class="state.saveState" aria-live="polite">{{ saveText }}</span>
      <span class="spacer" />
      <button v-if="state.phase !== 'empty'" class="btn ghost" @click="startOver">新建</button>
      <button class="btn ghost" @click="state.dialog = 'works'">我的作品</button>
    </header>

    <div v-if="state.phase === 'empty'" class="scroll"><UploadHome @pick="pick" /></div>

    <main v-else class="bench">
      <section class="stagecol">
        <Toolbar v-if="state.phase === 'result'" />
        <div v-else class="ready-head">
          <span class="badge">{{ state.kind === 'image' ? '原图' : `新建${KIND_LABELS[state.kind]}图纸` }}</span>
          <span class="muted">{{ readySummary }}</span>
        </div>
        <CanvasView v-if="state.phase === 'result'" ref="canvasView" />
        <MakerPreview v-else-if="state.kind !== 'image'" />
        <div v-else class="ready">
          <img :src="preview" alt="已上传的图片" :style="state.crop ? { objectFit: 'contain' } : {}" />
          <div v-if="state.generating" class="busy" role="status">正在生成…</div>
        </div>
        <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
        <p v-else-if="state.kind === 'qr' && state.edited" class="warn-line">二维码图纸改动过，拼之前请先用手机扫一下导出的图确认能扫。</p>
        <footer v-if="summary" class="summary num">{{ summary }}</footer>
      </section>

      <aside class="panel" :class="{ open: state.dialog === 'settings' }" aria-label="参数与用量">
        <div class="sheet-head">
          <div class="tabs" role="tablist">
            <button role="tab" :aria-selected="tab === 'settings'" @click="tab = 'settings'">设置</button>
            <button role="tab" :aria-selected="tab === 'usage'" :disabled="!state.doc" @click="tab = 'usage'">用量</button>
          </div>
          <button class="btn ghost icon close-sheet" aria-label="收起" @click="state.dialog = null">✕</button>
        </div>
        <div class="panel-body">
          <SettingsPanel v-if="tab === 'settings'" @export="openExport" @pick="pick" />
          <UsagePanel v-else />
        </div>
      </aside>

      <nav class="mobile-bar" aria-label="操作">
        <button class="btn secondary" @click="(tab = 'settings'), (state.dialog = 'settings')">参数</button>
        <button class="btn secondary" :disabled="!state.doc" @click="(tab = 'usage'), (state.dialog = 'settings')">用量</button>
        <button v-if="state.phase !== 'result'" class="btn primary" :disabled="state.generating" @click="generate">
          {{ state.generating ? '正在生成…' : '生成图纸' }}
        </button>
        <button v-else class="btn primary" @click="openExport">导出图纸</button>
      </nav>
    </main>

    <CropDialog v-if="state.dialog === 'crop' && state.source" />
    <ExportDialog v-if="state.dialog === 'export' && state.doc" />
    <WorksDialog v-if="state.dialog === 'works'" />
    <PaletteDialog v-if="state.dialog === 'palette' && state.doc" />
    <BrandDialog v-if="state.dialog === 'brand' && state.doc" />
    <ColorPickDialog v-if="state.colorPick" />
    <ConfirmDialog />
    <div v-if="state.notice" class="toast" role="status">{{ state.notice }}</div>
  </div>
</template>

<style scoped>
.app {
  height: 100dvh;
  display: flex;
  flex-direction: column;
}
.scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}
.top {
  flex: none;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: none;
  font-weight: 700;
  font-size: 16px;
  color: var(--ink);
  padding: 0;
}
.name {
  border: 0;
  background: none;
  font-weight: 600;
  color: var(--ink);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-left: 1px solid var(--line);
  padding: 0 12px;
  height: 32px;
}
.name-input {
  height: 32px;
  font-size: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 8px;
}
.save {
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.save.error {
  color: var(--warn);
}
.spacer {
  flex: 1;
}
.bench {
  flex: 1 1 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  /* the row must not grow to the settings panel's full content height */
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}
.stagecol {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  min-height: 0;
  min-width: 0;
}
.ready-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-bottom: 10px;
  min-height: 50px;
}
.badge {
  flex: none;
  white-space: nowrap;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 600;
}
.muted {
  color: var(--muted);
  font-size: 14px;
}
.ready {
  position: relative;
  flex: 1;
  min-height: 220px;
  background: var(--canvas);
  border-radius: 12px;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.ready img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.busy {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(238 241 239 / 0.7);
  font-weight: 600;
}
.summary {
  padding-top: 6px;
  color: var(--muted);
  font-size: 13px;
}
.error {
  color: var(--error);
  margin: 8px 0 0;
}
.warn-line {
  color: var(--warn);
  margin: 8px 0 0;
  font-size: 14px;
}
.panel {
  border-left: 1px solid var(--line);
  background: var(--panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.sheet-head {
  display: flex;
  align-items: center;
  padding: 12px 16px 0;
}
.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
}
.tabs button {
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  font-weight: 600;
  color: var(--muted);
}
.tabs button[aria-selected='true'] {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
.close-sheet {
  display: none;
}
.panel-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
.mobile-bar {
  display: none;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  background: var(--ink);
  color: #fff;
  padding: 10px 16px;
  border-radius: 10px;
  z-index: 60;
  max-width: calc(100vw - 32px);
}
@media (max-width: 1199px) {
  .bench {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
}
@media (max-width: 767px) {
  .app {
    height: auto;
    min-height: 100dvh;
  }
  .bench {
    flex: 1 0 auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    height: auto;
    min-height: calc(100dvh - 56px);
    padding-bottom: calc(72px + env(safe-area-inset-bottom));
  }
  .stagecol {
    padding: 8px 12px;
  }
  .ready,
  .stagecol :deep(.canvas-wrap),
  .stagecol :deep(.maker-preview) {
    min-height: 46dvh;
    flex: none;
    height: 46dvh;
  }
  .name {
    max-width: 120px;
    border-left: 0;
    padding: 0 4px;
  }
  .brand span {
    display: none;
  }
  .top {
    gap: 6px;
    padding: 0 8px;
  }
  .top .btn.ghost {
    padding: 0 8px;
  }
  .save {
    font-size: 12px;
  }
  .panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 75dvh;
    border-left: 0;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 32px rgb(0 0 0 / 0.18);
    transform: translateY(105%);
    transition: transform 160ms ease;
    z-index: 40;
  }
  .panel.open {
    transform: none;
  }
  .close-sheet {
    display: inline-flex;
  }
  .mobile-bar {
    display: flex;
    gap: 8px;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
    z-index: 30;
  }
  .mobile-bar .btn {
    height: 48px;
  }
  .mobile-bar .primary {
    flex: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .panel {
    transition: none;
  }
}
</style>

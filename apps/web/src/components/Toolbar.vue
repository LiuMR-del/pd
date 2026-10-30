<script setup lang="ts">
import { computed } from 'vue';
import { redo, state, undo, type Tool } from '../store';

const tools: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'move', label: '移动', key: 'V', icon: '✋' },
  { id: 'pen', label: '画笔', key: 'B', icon: '✏️' },
  { id: 'eraser', label: '橡皮', key: 'E', icon: '⌫' },
  { id: 'picker', label: '取色', key: 'I', icon: '💧' },
  { id: 'fill', label: '填充', key: 'G', icon: '🪣' },
  { id: 'replace', label: '替换', key: 'R', icon: '⇄' },
];

const canUndo = computed(() => (void state.version, state.editor?.canUndo ?? false));
const canRedo = computed(() => (void state.version, state.editor?.canRedo ?? false));
const hasSource = computed(() => !!state.source && !!state.sourceFrame);

function mirror(): void {
  state.editor?.mirrorHorizontal();
}
</script>

<template>
  <div class="toolbar">
    <div class="seg" role="radiogroup" aria-label="显示内容">
      <button role="radio" :aria-checked="state.viewMode === 'source'" :disabled="!hasSource" @click="state.viewMode = 'source'">原图</button>
      <button role="radio" :aria-checked="state.viewMode === 'pattern'" @click="state.viewMode = 'pattern'">图纸</button>
    </div>
    <div class="seg toggles" aria-label="图纸显示">
      <button :aria-pressed="state.showGrid" @click="state.showGrid = !state.showGrid">网格</button>
      <button :aria-pressed="state.showCodes" @click="state.showCodes = !state.showCodes">色号</button>
    </div>
    <div class="tools" role="toolbar" aria-label="编辑工具">
      <button
        v-for="t in tools"
        :key="t.id"
        class="tool"
        :aria-pressed="state.tool === t.id"
        :title="`${t.label}（${t.key}）`"
        @click="state.tool = t.id"
      >
        <span aria-hidden="true">{{ t.icon }}</span><span class="label">{{ t.label }}</span>
      </button>
    </div>
    <div class="tools">
      <button class="tool" :disabled="!canUndo" title="撤销（Ctrl/⌘+Z）" @click="undo"><span aria-hidden="true">↶</span><span class="label">撤销</span></button>
      <button class="tool" :disabled="!canRedo" title="重做（Ctrl/⌘+Shift+Z）" @click="redo"><span aria-hidden="true">↷</span><span class="label">重做</span></button>
      <button class="tool" title="左右翻转整张图纸（可撤销）" @click="mirror"><span aria-hidden="true">⇋</span><span class="label">镜像</span></button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  padding-bottom: 10px;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ink);
}
.tool:hover:not(:disabled) {
  background: var(--panel);
  border-color: var(--line);
}
.tool[aria-pressed='true'] {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}
.tool:disabled {
  opacity: 0.4;
}
@media (max-width: 1100px) {
  .tool .label {
    display: none;
  }
  .tool {
    width: 40px;
    justify-content: center;
    padding: 0;
  }
}
</style>

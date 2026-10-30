<script lang="ts">
/** Open modals, innermost last: only the top one reacts to Escape / Tab. */
const openStack: symbol[] = [];
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

// Vue casts an absent boolean prop to false, so the default must be explicit
const props = withDefaults(defineProps<{ title: string; width?: number; closable?: boolean }>(), { closable: true });
const emit = defineEmits<{ close: [] }>();
const box = ref<HTMLDivElement | null>(null);
let previous: HTMLElement | null = null;
const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;

const me = Symbol('modal');

function onKey(e: KeyboardEvent): void {
  if (openStack[openStack.length - 1] !== me) return;
  if (e.key === 'Escape' && props.closable) {
    e.stopPropagation();
    emit('close');
  }
  if (e.key === 'Tab' && box.value) {
    // keep focus inside the dialog
    const items = box.value.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

onMounted(async () => {
  openStack.push(me);
  window.addEventListener('keydown', onKey);
  previous = document.activeElement as HTMLElement | null;
  await nextTick();
  const target = box.value?.querySelector<HTMLElement>('[autofocus], .btn.primary, button, input, select');
  target?.focus();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  const i = openStack.indexOf(me);
  if (i >= 0) openStack.splice(i, 1);
  previous?.focus?.();
});
</script>

<template>
  <div class="backdrop" @click.self="closable && emit('close')">
    <div ref="box" class="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" :style="{ maxWidth: `${width ?? 520}px` }">
      <header>
        <h2 :id="titleId">{{ title }}</h2>
        <button v-if="closable" class="btn ghost icon" aria-label="关闭" @click="emit('close')">✕</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(20 30 28 / 0.4);
  display: grid;
  place-items: center;
  padding: 16px;
  z-index: 50;
}
.dialog {
  width: 100%;
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.18);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px 20px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
.body {
  padding: 8px 20px 16px;
  overflow: auto;
  min-height: 0;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--line);
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
@media (max-width: 767px) {
  .backdrop {
    padding: 0;
    place-items: end stretch;
  }
  .dialog {
    max-width: none !important;
    max-height: 92dvh;
    border-radius: 16px 16px 0 0;
  }
}
</style>

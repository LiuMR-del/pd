/// <reference types="@dcloudio/types" />

interface ImportMetaEnv {
  /** API base for the mini-program, e.g. http://192.168.1.5:3100/api for a phone on the same Wi-Fi. */
  readonly VITE_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

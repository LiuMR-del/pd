import { defineConfig } from 'vitest/config';

// Unit tests cover the platform-independent parts (worker message codec, generator client with a
// fake worker, worker bundle syntax); pages are checked in WeChat DevTools.
// vitest 3.2 here (5.x elsewhere): uni-app pins vite 5.2.8, which vitest 4+ no longer supports.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});

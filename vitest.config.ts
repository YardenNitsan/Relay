import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'web/**/*.test.ts'], testTimeout: 20000, hookTimeout: 30000, maxWorkers: 2 } });

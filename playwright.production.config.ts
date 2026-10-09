import {defineConfig} from '@playwright/test';
// Explicit opt-in: inspects the already running real local host, without fixtures.
export default defineConfig({testDir:'tests/production',workers:1,fullyParallel:false,timeout:60000,use:{baseURL:'http://127.0.0.1:4317',channel:'chrome',headless:true,trace:'off',screenshot:'off'},reporter:'list'});

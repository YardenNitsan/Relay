import './scripts/test-environment.mjs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e',fullyParallel:false,workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4319',channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node --import tsx scripts/e2e-server.ts',url:'http://127.0.0.1:4319',reuseExistingServer:false,timeout:60000},
  reporter:[['list'],['html',{open:'never'}]],
});

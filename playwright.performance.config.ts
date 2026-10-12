import {defineConfig} from '@playwright/test';
import base from './playwright.config';

export default defineConfig({...base,testDir:'tests/performance',timeout:180_000,outputDir:'output/performance/test-results',reporter:[['list']],webServer:{...base.webServer as object,command:'node --import tsx scripts/e2e-server.ts',url:'http://127.0.0.1:4319',reuseExistingServer:false,timeout:60_000,env:{RELAY_E2E_PERFORMANCE:'1'}}});

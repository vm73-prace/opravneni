// Celá Playwright sada znovu s ?debug=1 v každé otevřené adrese (DEBUG_PANEL=1, viz tests/pomocne.mjs).
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx playwright test', { stdio: 'inherit', shell: true, env: { ...process.env, DEBUG_PANEL: '1' } });
process.exit(r.status ?? 1);

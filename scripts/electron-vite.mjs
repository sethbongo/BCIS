// Runs electron-vite for the desktop workspace with a clean environment.
// Some editors export ELECTRON_RUN_AS_NODE=1 to their integrated terminals, which makes
// Electron start as plain Node.js and exit immediately; it must not reach the app.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const bin = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js');
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;

const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));

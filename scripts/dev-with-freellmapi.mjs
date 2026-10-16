import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const automationRoot = process.cwd();
const freeLlmRoot = process.env.FREELLMAPI_ROOT || 'D:\\freellmapi';
const freeLlmServer = path.join(freeLlmRoot, 'server');

if (!existsSync(path.join(freeLlmServer, 'package.json'))) {
  console.error(`FreeLLMAPI server was not found at ${freeLlmServer}. Set FREELLMAPI_ROOT to its location.`);
  process.exit(1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'dev'], { cwd: freeLlmServer, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
  spawn(process.execPath, ['server.js'], { cwd: automationRoot, stdio: 'inherit', env: process.env }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250);
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.error(`A development service stopped (${code ?? signal}).`);
      shutdown(code || 1);
    }
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

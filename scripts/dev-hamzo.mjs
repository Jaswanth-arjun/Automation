import { spawn } from 'node:child_process';
import path from 'node:path';

const automationRoot = process.cwd();
const landingPageDir = path.join(automationRoot, 'landing-page');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('🚀 Starting HAMZOOH Backend (Port 3000) & Frontend (Port 5173)...');

const children = [
  spawn(process.execPath, ['server.js'], {
    cwd: automationRoot,
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(npmCommand, ['run', 'dev'], {
    cwd: landingPageDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  }),
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
      console.error(`A service stopped (${code ?? signal}).`);
      shutdown(code || 1);
    }
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));


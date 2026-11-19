import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const automationRoot = process.cwd();
const landingPageDir = path.join(automationRoot, 'landing-page');

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

console.log('Starting HAMZOOH backend (port 3000) and frontend (port 5173)...');

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
    shell: isWindows,
  }),
];

let shuttingDown = false;

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (isWindows) {
    // npm.cmd runs through cmd.exe on Windows, so kill the whole tree.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 250);
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.error(`A service stopped (${code ?? signal}).`);
      shutdown(code || 1);
    }
  });
  child.on('error', (err) => {
    console.error('Could not start a service:', err.message);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

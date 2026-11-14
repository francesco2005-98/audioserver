import { spawn } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const sourceDir = join(root, 'ui', 'admin');
const distDir = join(sourceDir, 'dist');
const targetDir = join(root, 'public', 'admin');

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

await run('npm', ['ci'], sourceDir);
await run('npm', ['run', 'build'], sourceDir);
await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(distDir, targetDir, { recursive: true });

#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const dir = path.join(__dirname, '..', 'apps', 'frontend');
let next = path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
try { require.resolve(next); } catch {
  // Hoisted to root node_modules in monorepo
  next = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next');
}

const child = spawn(process.execPath, [next, 'dev'], {
  cwd: dir,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));

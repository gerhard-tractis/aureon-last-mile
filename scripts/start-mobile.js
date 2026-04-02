#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const dir = path.join(__dirname, '..', 'apps', 'mobile');
const cli = path.join(dir, 'node_modules', 'expo', 'bin', 'cli');

const child = spawn(process.execPath, [cli, 'start', '--web'], {
  cwd: dir,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));

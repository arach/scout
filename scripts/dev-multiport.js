#!/usr/bin/env node

/**
 * Multi-port development script for Scout
 * Allows running multiple Tauri instances on different ports
 * 
 * Usage:
 *   node scripts/dev-multiport.js [port]
 *   pnpm tauri:dev:1425
 *   pnpm tauri:dev:1430
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = process.argv[2] || '5173';
const hmrPort = (parseInt(port) + 1).toString();

console.log(`🚀 Starting Scout on port ${port} (HMR: ${hmrPort})`);

// Set environment variables for Vite
process.env.VITE_PORT = port;
process.env.VITE_HMR_PORT = hmrPort;

// Read the original Tauri config
const configPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
const originalConfig = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(originalConfig);

// Update the devUrl
config.build.devUrl = `http://localhost:${port}`;

// Write temporary config
const tempConfigPath = configPath + '.tmp';
fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));

// Backup original and use temp
const backupPath = configPath + '.backup';
fs.renameSync(configPath, backupPath);
fs.renameSync(tempConfigPath, configPath);

// Restore original config on exit
const cleanup = () => {
  try {
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, configPath);
    }
  } catch (e) {
    console.error('Failed to restore config:', e);
  }
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// Run pnpm tauri dev
const tauri = spawn('pnpm', ['tauri', 'dev'], {
  stdio: 'inherit'
});

tauri.on('close', (code) => {
  console.log(`Tauri exited with code ${code}`);
  cleanup();
});
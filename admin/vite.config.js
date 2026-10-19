import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
function backendTarget() {
  if (process.env.VOTING_API_TARGET) return process.env.VOTING_API_TARGET;
  let port = process.env.PORT || '5000';
  try {
    const config = readFileSync(new URL('../config.env', import.meta.url), 'utf8');
    const found = config.match(/^\s*PORT\s*=\s*['"]?(\d+)['"]?\s*(?:#.*)?$/m);
    if (!process.env.PORT && found) port = found[1];
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return `http://127.0.0.1:${port}`;
}
export default defineConfig({ esbuild: { jsx: 'automatic' }, server: { port: 5174, proxy: { '/api': backendTarget(), '/uploads': backendTarget() } }, preview: { proxy: { '/api': backendTarget(), '/uploads': backendTarget() } } });

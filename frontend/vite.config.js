import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Read only PORT on the server side; never expose backend secrets to the client.
function backendTarget() {
  if (process.env.VOTING_API_TARGET) return process.env.VOTING_API_TARGET;
  let port = process.env.PORT || '5000';
  try {
    const config = readFileSync(new URL('../config.env', import.meta.url), 'utf8');
    const configured = config.match(/^\s*PORT\s*=\s*['"]?(\d+)['"]?\s*(?:#.*)?$/m);
    if (!process.env.PORT && configured) port = configured[1];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return `http://127.0.0.1:${port}`;
}

export default defineConfig(() => {
  const target = backendTarget();
  const proxy = { '/api': target, '/uploads': target };
  return { esbuild: { jsx: 'automatic' }, server: { proxy }, preview: { proxy } };
});

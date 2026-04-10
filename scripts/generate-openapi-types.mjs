import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const args = [
  'openapi-typescript',
  resolve(projectRoot, 'openapi', 'openapi.json'),
  '--output',
  resolve(projectRoot, 'src', 'shared', 'api', 'generated', 'openapi-types.ts'),
];

const result = spawnSync(command, args, {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

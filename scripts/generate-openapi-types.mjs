import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'openapi-typescript',
  'openapi/openapi.json',
  '--output',
  'src/shared/api/generated/openapi-types.ts',
];

const result = spawnSync(command, args, { stdio: 'inherit' });
if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceUrl = process.argv[2] || process.env.BE_OPENAPI_URL || 'http://localhost:8080/v3/api-docs';
const outputPath = resolve(process.cwd(), 'openapi', 'openapi.json');

async function run() {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to sync OpenAPI: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  await mkdir(resolve(process.cwd(), 'openapi'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(json, null, 2)}\n`, 'utf-8');
  console.log(`OpenAPI synced to ${outputPath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

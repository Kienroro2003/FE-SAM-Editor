import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const sourceUrl = process.argv[2] || process.env.BE_OPENAPI_URL || 'http://127.0.0.1:8080/v3/api-docs';
const outputDir = resolve(projectRoot, 'openapi');
const outputPath = resolve(outputDir, 'openapi.json');

function resolveIpv4LoopbackFallback(url) {
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname !== 'localhost') {
    return null;
  }

  parsedUrl.hostname = '127.0.0.1';
  return parsedUrl.toString();
}

function shouldRetryWithIpv4Loopback(error) {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const errorCause = error.cause;
  return Boolean(
    errorCause &&
      typeof errorCause === 'object' &&
      'code' in errorCause &&
      (errorCause.code === 'ENOTFOUND' || errorCause.code === 'ECONNREFUSED'),
  );
}

async function fetchOpenApi(url) {
  return fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
}

async function run() {
  let response;

  try {
    response = await fetchOpenApi(sourceUrl);
  } catch (error) {
    const fallbackUrl = resolveIpv4LoopbackFallback(sourceUrl);
    if (!fallbackUrl || !shouldRetryWithIpv4Loopback(error)) {
      throw error;
    }

    console.warn(`Retrying OpenAPI sync with IPv4 loopback: ${fallbackUrl}`);
    response = await fetchOpenApi(fallbackUrl);
  }

  if (!response.ok) {
    throw new Error(`Failed to sync OpenAPI: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(json, null, 2)}\n`, 'utf-8');
  console.log(`OpenAPI synced to ${outputPath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

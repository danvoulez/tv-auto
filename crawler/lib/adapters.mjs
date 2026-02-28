import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const crawlerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_ADAPTER = 'default.mjs';

function sanitizeDomain(domain) {
  return domain.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
}

export async function resolveAdapterForUrl(url, overrides = {}) {
  const hostname = new URL(url).hostname.toLowerCase();
  const override = overrides[hostname];
  const candidates = [];

  if (override) candidates.push(override);
  candidates.push(`${sanitizeDomain(hostname)}.mjs`, DEFAULT_ADAPTER);

  const adaptersDir = path.join(crawlerRoot, 'adapters');
  for (const candidate of candidates) {
    const filePath = path.join(adaptersDir, candidate);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      if (mod?.adapter) return mod.adapter;
    } catch {
      // keep trying candidates
    }
  }

  throw new Error(`No adapter found for ${hostname}`);
}

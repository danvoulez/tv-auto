import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

  for (const candidate of candidates) {
    const filePath = path.resolve('crawler/adapters', candidate);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      if (mod?.adapter) return mod.adapter;
    } catch {
      // keep trying candidates
    }
  }

  throw new Error(`No adapter found for ${hostname}`);
}

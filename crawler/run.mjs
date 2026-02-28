import crypto from 'node:crypto';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import { loadCrawlerConfig } from './lib/config.mjs';
import { resolveAdapterForUrl } from './lib/adapters.mjs';
import { canonicalizeUrl, isAllowlistedUrl, isHttpUrl, toHostname, violatesKeywordPolicy } from './lib/policy.mjs';

function makeEvent(url, status, reason, details = {}) {
  return {
    ts: new Date().toISOString(),
    url,
    status,
    reason,
    ...details
  };
}

function randomBetween(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeEvidenceHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isDomainAllowed(hostname, allowlistDomains, extraAllowed = []) {
  const all = [...allowlistDomains, ...extraAllowed].map((d) => d.toLowerCase());
  return all.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function toDiscoveryInput(url, extracted, hdConfirmed, evidenceHash = null) {
  const output = {
    source_url: url,
    title: extracted.title || '',
    duration_sec: extracted.duration_sec ?? 0,
    theme_tags: Array.isArray(extracted.theme_tags) ? extracted.theme_tags : [],
    visual_features: Array.isArray(extracted.visual_features) ? extracted.visual_features : [],
    quality_signals: Array.isArray(extracted.quality_signals) ? extracted.quality_signals : [],
    hd_confirmed: hdConfirmed
  };

  if (evidenceHash) output.evidence_hash = evidenceHash;
  return output;
}

async function main() {
  const config = await loadCrawlerConfig();
  const queue = await RequestQueue.open();

  const candidates = [...(config.seed_urls || []), ...(config.discovery_roots || [])];
  const seen = new Set();

  for (const rawUrl of candidates) {
    if (!isHttpUrl(rawUrl)) {
      console.error(JSON.stringify(makeEvent(rawUrl, 'skipped', 'invalid_or_non_http_url')));
      continue;
    }

    const url = canonicalizeUrl(rawUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    if (isAllowlistedUrl(url, config.allowlist_domains)) {
      await queue.addRequest({ url, uniqueKey: url });
    } else {
      console.error(JSON.stringify(makeEvent(url, 'skipped', 'outside_allowlist')));
    }
  }

  const discoveries = [];
  const events = [];
  const domainFailures = new Map();

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    maxConcurrency: config.max_concurrency,
    navigationTimeoutSecs: Math.ceil(config.navigation_timeout_ms / 1000),
    maxRequestRetries: 1,
    launchContext: {
      launchOptions: { headless: true }
    },
    async requestHandler({ request, page, log }) {
      const url = canonicalizeUrl(request.loadedUrl || request.url);
      const domain = toHostname(url);
      const currentFailures = domainFailures.get(domain) || 0;
      if (currentFailures >= config.domain_error_budget) {
        events.push(makeEvent(url, 'skipped', 'domain_circuit_open', { domain, currentFailures }));
        return;
      }

      if (!isAllowlistedUrl(url, config.allowlist_domains)) {
        events.push(makeEvent(url, 'skipped', 'outside_allowlist_runtime'));
        return;
      }

      const randomDelay = randomBetween(config.random_delay_ms_min, config.random_delay_ms_max);
      if (randomDelay > 0) await page.waitForTimeout(randomDelay);

      const crossDomainCalls = new Set();
      await page.route('**/*', async (route) => {
        const targetUrl = route.request().url();
        const targetHost = toHostname(targetUrl);
        if (!targetHost) {
          await route.continue();
          return;
        }

        if (!isDomainAllowed(targetHost, config.allowlist_domains, config.allowed_resource_domains)) {
          crossDomainCalls.add(targetHost);
          if (config.resource_domain_policy === 'enforce') {
            await route.abort();
            return;
          }
        }

        await route.continue();
      });

      try {
        const adapter = await resolveAdapterForUrl(url, config.adapter_overrides);
        await adapter.waitForPlayer(page, config.navigation_timeout_ms);
        const playResult = await adapter.triggerPlay(page);
        await page.waitForTimeout(config.playback_wait_ms);
        const extracted = await adapter.extract(page);

        const textForPolicy = `${extracted.title} ${(extracted.theme_tags || []).join(' ')}`;
        const policy = violatesKeywordPolicy(
          textForPolicy,
          config.blacklist_keywords,
          config.blocked_keywords
        );
        if (policy.blocked) {
          events.push(makeEvent(url, 'dropped', policy.reason, { title: extracted.title || '' }));
          return;
        }

        const height = extracted?.resolution?.height || 0;
        const hdConfirmed = height >= (config.min_hd_height || 720) && playResult?.ok === true;
        if (config.require_hd_playback_confirmation && !hdConfirmed) {
          events.push(makeEvent(url, 'dropped', 'hd_not_confirmed', { height }));
          return;
        }

        const evidenceHash = config.emit_evidence_hash
          ? makeEvidenceHash({ url, extracted, playResult, randomDelay })
          : null;

        discoveries.push(toDiscoveryInput(url, extracted, hdConfirmed, evidenceHash));
        events.push(
          makeEvent(url, 'accepted', 'ok', {
            title: extracted.title || '',
            duration_sec: extracted.duration_sec || 0,
            hd_confirmed: hdConfirmed,
            random_delay_ms: randomDelay,
            cross_domain_calls: [...crossDomainCalls],
            evidence_hash: evidenceHash
          })
        );
        log.info(`Accepted URL: ${url}`);
      } catch (error) {
        domainFailures.set(domain, currentFailures + 1);
        events.push(makeEvent(url, 'error', 'crawl_failed', { error: String(error), domain }));
      }
    },
    failedRequestHandler({ request, error }) {
      const url = canonicalizeUrl(request.url);
      const domain = toHostname(url);
      domainFailures.set(domain, (domainFailures.get(domain) || 0) + 1);
      events.push(makeEvent(url, 'error', 'request_failed', { error: String(error) }));
    }
  });

  await crawler.run();

  process.stdout.write(`${JSON.stringify(discoveries, null, 2)}\n`);
  process.stderr.write(
    `${JSON.stringify({ crawl_events: events, domain_failures: Object.fromEntries(domainFailures) }, null, 2)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ fatal: String(error) }, null, 2)}\n`);
  process.exit(1);
});

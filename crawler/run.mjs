import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import { loadCrawlerConfig } from './lib/config.mjs';
import { resolveAdapterForUrl } from './lib/adapters.mjs';
import { isAllowlistedUrl, violatesKeywordPolicy } from './lib/policy.mjs';

function makeEvent(url, status, reason, details = {}) {
  return {
    ts: new Date().toISOString(),
    url,
    status,
    reason,
    ...details
  };
}

function toDiscoveryInput(url, extracted, hdConfirmed) {
  return {
    source_url: url,
    title: extracted.title || '',
    duration_sec: extracted.duration_sec ?? 0,
    theme_tags: Array.isArray(extracted.theme_tags) ? extracted.theme_tags : [],
    visual_features: Array.isArray(extracted.visual_features) ? extracted.visual_features : [],
    quality_signals: Array.isArray(extracted.quality_signals) ? extracted.quality_signals : [],
    hd_confirmed: hdConfirmed
  };
}

async function main() {
  const config = await loadCrawlerConfig();
  const queue = await RequestQueue.open();

  const candidates = [...(config.seed_urls || []), ...(config.discovery_roots || [])];
  for (const url of candidates) {
    if (isAllowlistedUrl(url, config.allowlist_domains)) {
      await queue.addRequest({ url, uniqueKey: url });
    } else {
      console.error(JSON.stringify(makeEvent(url, 'skipped', 'outside_allowlist')));
    }
  }

  const discoveries = [];
  const events = [];

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    maxConcurrency: config.max_concurrency,
    navigationTimeoutSecs: Math.ceil(config.navigation_timeout_ms / 1000),
    launchContext: {
      launchOptions: { headless: true }
    },
    async requestHandler({ request, page, log }) {
      const url = request.loadedUrl || request.url;
      if (!isAllowlistedUrl(url, config.allowlist_domains)) {
        events.push(makeEvent(url, 'skipped', 'outside_allowlist_runtime'));
        return;
      }

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

        discoveries.push(toDiscoveryInput(url, extracted, hdConfirmed));
        events.push(
          makeEvent(url, 'accepted', 'ok', {
            title: extracted.title || '',
            duration_sec: extracted.duration_sec || 0,
            hd_confirmed: hdConfirmed
          })
        );
        log.info(`Accepted URL: ${url}`);
      } catch (error) {
        events.push(makeEvent(url, 'error', 'crawl_failed', { error: String(error) }));
      }
    },
    failedRequestHandler({ request, error }) {
      events.push(makeEvent(request.url, 'error', 'request_failed', { error: String(error) }));
    }
  });

  await crawler.run();

  process.stdout.write(`${JSON.stringify(discoveries, null, 2)}\n`);
  process.stderr.write(`${JSON.stringify({ crawl_events: events }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ fatal: String(error) }, null, 2)}\n`);
  process.exit(1);
});

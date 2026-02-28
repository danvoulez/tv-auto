# Bold final plan: VVTV crawler

Real discovery that replaces the seed. One document, one plan.

---

## 1. Goal in one line

**Crawler:** given the OwnerCard allowlist, visit only those domains, run real playback in a real browser, confirm HD when required, extract metadata, and return a list of `DiscoveryInput` that the existing Rust `DiscoveryEngine` turns into `PlanItem`s. No mock data.

---

## 2. Principles (non-negotiable)

- **Allowlist-only.** No URL is ever visited unless its domain is in `search_policy.allowlist_domains`.
- **Real playback when HD is required.** If `safety_policy.require_hd_playback_confirmation` is true, we open the page, trigger play, and only then read resolution. No “trust the page title.”
- **One source of truth.** OwnerCard (YAML) drives allowlist, blacklist, blocked keywords, and HD policy. The crawler does not add its own policy layer.
- **Auditable.** Every discovered item has a clear path: which domain, which URL, whether HD was confirmed, and why it passed or failed. Logs and events feed the existing audit trail.
- **Fail safe.** Crawler crashes, timeouts, or blocklists must not take down the rest of the pipeline. Discovery is a best-effort input to planning; the pipeline already has reserves and fallbacks.

---

## 3. Architecture: hybrid Rust + Node

- **Rust (LAB):** Stays the brain. Orchestrator loads OwnerCard, decides *when* to run discovery and *which* policy to use. It calls the crawler as a **subprocess or local HTTP service**, passes policy (allowlist, blacklist, blocked_keywords, require_hd_playback), and receives **structured output** that matches `DiscoveryInput`.
- **Crawler (Node):** A single, well-bounded service or CLI that:
  - Reads config (env or JSON) derived from OwnerCard.
  - Builds a **queue of URLs** only from allowlist domains (e.g. from sitemaps, listing pages, or a fixed “seed URLs” file per domain).
  - For each URL: open in browser → optional init script (block ads/trackers) → trigger play → wait → run **extractor script** in page context → read title, duration, resolution, HD.
  - Applies blacklist and blocked_keywords in memory; skips or drops items that don’t match.
  - Outputs **JSON array of `DiscoveryInput`** (or NDJSON) to stdout or HTTP response so Rust can parse and pass to `DiscoveryEngine::discover(owner_card, &inputs)`.

No Rust rewrite of the browser. No headless in Rust for v1. We use the best-in-class Node stack (Playwright + Crawlee) and keep the Rust contract (`DiscoveryInput` → `PlanItem`) unchanged.

---

## 4. Stack (bold choices)

| Layer | Choice | Why |
|-------|--------|-----|
| **Browser automation** | **Playwright** (Chromium/Chrome) | Real browser, real playback, Chrome for Testing, good JS execution and CDP. |
| **Crawling harness** | **Crawlee** (PlaywrightCrawler) | Request queue, retries, concurrency, proxy rotation, human-like fingerprints. We use it as the “scheduler” around Playwright. |
| **JS in the page** | **page.evaluate() + addInitScript()** | Extract title, duration, resolution after play; optionally inject ad/tracker blocking or helpers before page scripts run. |
| **Hard sites (optional v2)** | **Chrome extension** loaded via Playwright `launchPersistentContext` | When a domain is too strict (anti-bot, heavy fingerprinting), we run the same flow with an extension that does in-page extraction and reports back; Playwright still drives navigation. |
| **Proxies (optional)** | Crawlee `ProxyConfiguration` | Rotate IPs per session or per domain to reduce rate limits and blocks; configurable per env, not in OwnerCard. |
| **Rust ↔ Crawler** | **Subprocess (stdin/stdout) or local HTTP** | Orchestrator spawns `node crawler/run.js --config -` or POSTs config to `localhost:PORT/crawl` and reads `DiscoveryInput[]` from stdout or JSON response. No distributed queue for v1. |

---

## 5. Data flow (end-to-end)

```text
OwnerCard (YAML)
       ↓
Orchestrator (Rust): builds crawler config (allowlist, blacklist, blocked_keywords, require_hd_playback)
       ↓
Crawler (Node): Crawlee queue filled from “seed URLs per allowlist domain” (file or simple discovery)
       ↓
For each URL (allowlist-only):
  1. Playwright opens URL (Chromium, optional extension for hard domains).
  2. addInitScript (optional): block known ad/tracker domains.
  3. Wait for player (selector or timeout).
  4. evaluate: click play (e.g. video.play() or site-specific button).
  5. Wait N seconds (e.g. 5–10).
  6. evaluate: read title, duration_sec, resolution (and any theme/visual/quality signals the site exposes).
  7. Map to DiscoveryInput { source_url, title, duration_sec, theme_tags, visual_features, quality_signals, hd_confirmed }.
  8. Apply blacklist + blocked_keywords in memory; drop if not allowed.
       ↓
Crawler outputs JSON array of DiscoveryInput (stdout or HTTP).
       ↓
Orchestrator (Rust): parse JSON → DiscoveryEngine::discover(owner_card, &inputs) → PlanItem[] → existing planner/commit/prep/queue/stream.
```

Rust’s `DiscoveryEngine` stays as is: it still filters by allowlist/blacklist/blocked_keywords and `hd_confirmed`; the only change is that `inputs` come from the crawler instead of `seed_discovery_inputs()`.

---

## 6. Crawler output contract (Rust-friendly)

The crawler MUST output a JSON array of objects that match `DiscoveryInput`:

```json
[
  {
    "source_url": "https://allowlisted-domain.com/video/123",
    "title": "Example Title",
    "duration_sec": 900,
    "theme_tags": ["tag1", "tag2"],
    "visual_features": [],
    "quality_signals": ["1080p", "hd"],
    "hd_confirmed": true
  }
]
```

- `hd_confirmed`: `true` only when we actually ran playback and read resolution ≥ min (e.g. 720). Otherwise `false`; Rust will drop the item if OwnerCard requires HD confirmation.
- Empty arrays for `theme_tags` / `visual_features` are fine; they can be enriched later or by nightly.

---

## 7. Per-domain adapters (bold but practical)

Sites differ: different player selectors, different ways to read title/duration/resolution. We avoid one giant “if domain A then … else if domain B …” in a single script.

- **Adapter:** a small JS (or JSON config + tiny runner) that, for a given domain, defines:
  - Optional: selectors or URLs to “discover” links (listing pages, sitemaps).
  - Player selector (or “use first video”).
  - How to trigger play (e.g. `document.querySelector('video').play()` or click on a button).
  - How to read title, duration_sec, resolution (from DOM or `window`).
- **Registry:** `crawler/adapters/<domain-sanitized>.js` (or `.json`) — one file per allowlist domain. Default adapter: generic (first `video`, document.title, video.videoWidth/Height, video.duration).
- Crawler loads the adapter for the current URL’s domain and runs that adapter’s “extract” logic inside `page.evaluate()`. New domain = new adapter, no change to core crawler.

---

## 8. Hardening (armour)

- **Blocklists in init script:** `addInitScript` can block known ad/tracker domains (from a small curated list) so the page loads with fewer pop-ups and redirects. Not in OwnerCard; crawler config or env.
- **Timeouts:** Per-page and per-step timeouts (e.g. 30s page load, 15s for “play + read”). On timeout, log and skip URL; continue queue.
- **Concurrency:** Crawlee’s `maxConcurrency` (e.g. 2–3) so we don’t open 50 tabs; reduces detection and resource use.
- **No cookies by default:** Fresh context per run unless we explicitly add “use profile for domain X” later.
- **Evidence log:** For each URL we attempt, log: domain, url, hd_confirmed, duration_sec, and a short reason (e.g. “ok”, “timeout”, “blocked_keyword”). This feeds audit and debugging.

---

## 9. Where it lives in the repo

- **`crawler/`** (new top-level, sibling to `apps/` and `crates/`):
  - `package.json` (Node, Playwright + Crawlee).
  - `run.js` (or `run.mjs`): entrypoint; reads config from argv/env or stdin; runs Crawlee PlaywrightCrawler; prints `DiscoveryInput[]` to stdout.
  - `adapters/default.js`: generic extractor (video element, document.title, duration, resolution).
  - `adapters/<domain>.js`: optional per-domain extractors.
  - `config.schema.json`: optional JSON schema for the config we pass from Rust so we can validate before calling the crawler.
- **Rust:**
  - `apps/vvtv-orchestrator`: when it’s time for a discovery window, build a small JSON config from OwnerCard (allowlist, blacklist, blocked_keywords, require_hd_playback, optional seed URLs or “discovery roots” per domain), then either:
    - Spawn `node crawler/run.js --config -` with config on stdin and read stdout, or
    - POST config to `http://127.0.0.1:PORT/crawl` and read JSON body (if we run crawler as a long-lived service).
  - Parse JSON into `Vec<DiscoveryInput>`, call `DiscoveryEngine::discover(owner_card, &inputs)`, then `Planner::build_day` etc. as today.
- **Config/ownership:** Allowlist/blacklist/blocked_keywords/require_hd_playback come from OwnerCard only. Seed URLs or “discovery roots” can live in a small file under `config/crawler-seeds.yaml` (or in OwnerCard later if we extend the schema). That file lists, per allowlist domain, a few starting URLs or sitemap URLs so the crawler has something to enqueue.

---

## 10. Phases (execution order)

| Phase | What | Done when |
|-------|------|-----------|
| **1 – Crawler core** | Node project under `crawler/`. Playwright + Crawlee. Single URL in → open page → play → evaluate extractor → output one `DiscoveryInput`. CLI: `node run.js --url "..." --require-hd` → JSON on stdout. | One URL end-to-end from CLI to valid `DiscoveryInput`. |
| **2 – Queue and allowlist** | Crawler accepts config (allowlist, blacklist, blocked_keywords, require_hd). Queue built from a simple list of seed URLs (file or config). For each URL, run play + extract; filter by blacklist and blocked_keywords; output full array. | Many URLs, only allowlisted, filtered; stdout = `DiscoveryInput[]`. |
| **3 – Rust integration** | Orchestrator builds config from OwnerCard, spawns crawler (or POSTs), parses JSON into `Vec<DiscoveryInput>`, calls `DiscoveryEngine::discover(owner_card, &inputs)`. Remove or gate `seed_discovery_inputs()`. | One discovery window in the wild uses real crawler output. |
| **4 – Adapters and init script** | Default adapter + one or two real allowlist domains with custom adapters. Optional `addInitScript` to block known ad/tracker hosts. | At least two domains working with different page structures. |
| **5 – Extension and proxies (optional)** | For one “hard” domain, add a small Chrome extension that does in-page extraction; load it via Playwright `launchPersistentContext`. Optional: Crawlee proxy rotation for that domain or globally. | Crawler works on a site that blocks plain headless. |

---

## 11. Success criteria

- **Functional:** Every item in the pipeline that came from “discovery” has a `source_url` that was actually visited by the crawler, and if OwnerCard requires HD, `hd_confirmed` was set only after real playback.
- **Policy:** No URL outside `search_policy.allowlist_domains` is ever requested by the crawler.
- **Observable:** We can answer “why did this URL get dropped?” (timeout, blocked keyword, blacklist, or HD not confirmed) from logs or audit.
- **Resilient:** Crawler timeout or crash does not crash the orchestrator; discovery returns an empty or partial list and the rest of the pipeline (reserves, fallbacks) still runs.

---

## 12. What we do *not* do in v1

- No Rust headless browser (we use Node + Playwright).
- No distributed queue (e.g. Redis); queue is in-process Crawlee.
- No “crawl the entire internet”; we only crawl explicitly allowlisted domains and seed URLs we configure.
- No DRM or geo-unlock in the crawler; we only observe what the page shows after a normal play.
- No recommendation or “audience feedback” in discovery; that’s out of scope per blueprint.

---

This is the bold final plan: **Crawlee + Playwright + JS in the page, contract = `DiscoveryInput[]`, Rust stays the brain, optional extension and proxies for hard sites, and a clear path from “one URL” to “full discovery window in production.”**

---

## 13. Hardening++ (implemented baseline + bold extensions)

### Baseline hardening now

- URL canonicalization and HTTP(S)-only gate before enqueue.
- Per-domain circuit breaker (`domain_error_budget`) to stop wasting budget on failing domains.
- Random delay jitter per request to reduce deterministic bot fingerprints.
- Resource-domain policy with `off/report/enforce` to monitor or block third-party resource calls outside allowlist.
- Evidence hash (`sha256`) per accepted item to strengthen auditability and replay diagnostics.

### Bold/original/effective proposals

- **Proof-of-play artifacts:** persist short media proof bundle (frame hash + media timestamp + evidence hash) for high-trust compliance checks.
- **Adapter tournament mode:** run multiple extraction strategies in parallel sampling windows and auto-promote the highest precision strategy.
- **Preflight canary scoring:** health-check 1 URL/domain before full crawl; domains with low health get downgraded concurrency automatically.
- **Cross-verification HD engine:** combine DOM resolution, quality menu text, and CDP media events; require quorum to mark HD on strict profiles.

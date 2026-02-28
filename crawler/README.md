# VVTV Crawler (implementation)

Node-based discovery crawler for VVTV, designed to be called by the Rust orchestrator.

## What it enforces

- Allowlist-only URL processing (`allowlist_domains`)
- Real playback attempt before HD confirmation
- Keyword filtering (`blocked_keywords` and `blacklist_keywords`)
- Structured output compatible with `DiscoveryInput[]`

## Quick start

```bash
cd crawler
npm install
node run.mjs --config config/example.config.json
```

Or single URL mode:

```bash
node run.mjs --url "https://example.com" --require-hd
```

## Rust integration contract

- Input: JSON config via file path or stdin (`--config -`)
- Output (stdout): JSON array of discovery objects
- Logs/events (stderr): JSON event summary with accepted/dropped/error reasons

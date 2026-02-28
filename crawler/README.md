# VVTV Crawler (implementation)

Node-based discovery crawler for VVTV, designed to be called by the Rust orchestrator.

## What it enforces

- Allowlist-only URL processing (`allowlist_domains`)
- Real playback attempt before HD confirmation
- Keyword filtering (`blocked_keywords` and `blacklist_keywords`)
- Structured output compatible with `DiscoveryInput[]`
- Hardening controls:
  - URL canonicalization + HTTP(S)-only input
  - Domain circuit breaker (`domain_error_budget`)
  - Randomized pacing (`random_delay_ms_min/max`)
  - Resource-domain guard (`resource_domain_policy=off|report|enforce`)
  - Evidence hash per accepted discovery (`emit_evidence_hash`)

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

## Soluções ousadas (próximas evoluções)

1. **Stealth attestation pipeline**
   - Salvar `evidence_hash` + mini-prova do frame de vídeo (hash perceptual + timestamp) para auditoria anti-fraude.
2. **Adapter auto-tuning por domínio**
   - Medir taxa de sucesso de seletor/playback por adapter e auto-promover estratégias mais eficazes.
3. **Canary crawl antes da janela principal**
   - Rodar 1 URL por domínio como “sonda”; se falhar, abrir circuito e evitar custo total naquele domínio.
4. **Dual-mode extraction (DOM + CDP media events)**
   - Cruzar o `videoHeight` do DOM com eventos de mídia da sessão CDP para reduzir falso-HD.

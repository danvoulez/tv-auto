import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '..', 'config.schema.json');

function parseArgs(argv) {
  const args = { configPath: null, inlineUrl: null, requireHd: null };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--config') args.configPath = argv[i + 1];
    if (current === '--url') args.inlineUrl = argv[i + 1];
    if (current === '--require-hd') args.requireHd = true;
  }
  return args;
}

async function readConfigInput(configPath) {
  if (!configPath) return null;
  if (configPath === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  return fs.readFile(configPath, 'utf8');
}

export async function loadCrawlerConfig(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const raw = await readConfigInput(args.configPath);

  const base = raw ? JSON.parse(raw) : {};
  if (args.inlineUrl) {
    base.seed_urls = [args.inlineUrl];
    if (!base.allowlist_domains) base.allowlist_domains = [new URL(args.inlineUrl).hostname];
  }
  if (args.requireHd !== null) {
    base.require_hd_playback_confirmation = true;
  }

  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, useDefaults: true });
  const validate = ajv.compile(schema);
  if (!validate(base)) {
    const message = ajv.errorsText(validate.errors, { separator: '\n' });
    throw new Error(`Invalid crawler config:\n${message}`);
  }

  base.allowlist_domains = [...new Set(base.allowlist_domains.map((d) => d.toLowerCase().trim()))];
  base.allowed_resource_domains = [
    ...new Set((base.allowed_resource_domains || []).map((d) => d.toLowerCase().trim()))
  ];

  if (base.random_delay_ms_max < base.random_delay_ms_min) {
    throw new Error('Invalid crawler config: random_delay_ms_max must be >= random_delay_ms_min');
  }

  return base;
}

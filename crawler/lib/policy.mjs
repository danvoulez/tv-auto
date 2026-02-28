export function toUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function toHostname(input) {
  return toUrl(input)?.hostname.toLowerCase() || '';
}

export function isHttpUrl(input) {
  const parsed = toUrl(input);
  return parsed ? parsed.protocol === 'http:' || parsed.protocol === 'https:' : false;
}

export function canonicalizeUrl(input) {
  const parsed = toUrl(input);
  if (!parsed) return '';
  parsed.hash = '';
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  return parsed.toString();
}

export function isAllowlistedUrl(url, allowlistDomains) {
  const hostname = toHostname(url);
  if (!hostname) return false;
  return allowlistDomains.some((domain) => {
    const normalized = domain.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

export function violatesKeywordPolicy(text, blacklistKeywords = [], blockedKeywords = []) {
  const normalized = (text || '').toLowerCase();
  const hitBlocked = blockedKeywords.find((k) => normalized.includes(k.toLowerCase()));
  if (hitBlocked) return { blocked: true, reason: `blocked_keyword:${hitBlocked}` };

  const hitBlacklist = blacklistKeywords.find((k) => normalized.includes(k.toLowerCase()));
  if (hitBlacklist) return { blocked: true, reason: `blacklist_keyword:${hitBlacklist}` };

  return { blocked: false, reason: 'ok' };
}

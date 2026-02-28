export function toHostname(input) {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return '';
  }
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

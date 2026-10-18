const TRACKING_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "ref"]);

export function normalizeComparisonUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith("utm_") || TRACKING_KEYS.has(lowerKey)) {
      url.searchParams.delete(key);
    }
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/$/, "");
  }
  if ([...url.searchParams].length === 0) {
    url.search = "";
  }
  return url.toString();
}

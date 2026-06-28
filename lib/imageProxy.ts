/**
 * Generated images are hosted on kie.ai CDNs that do NOT send CORS headers, so
 * the browser can't read their pixels (to crop) or fetch their bytes (to
 * download). We route those reads through images.weserv.nl, a well-known free
 * image proxy that re-serves any public image WITH `Access-Control-Allow-Origin`,
 * which makes both canvas cropping and blob downloads work.
 *
 * Only public, non-sensitive generated images pass through it. data: URLs and
 * already-local images are returned unchanged.
 */
export function proxiedImageUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  const stripped = url.replace(/^https?:\/\//i, "");
  // `ssl:` forces weserv to fetch the origin over https.
  return `https://images.weserv.nl/?url=${encodeURIComponent("ssl:" + stripped)}`;
}

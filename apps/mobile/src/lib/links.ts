/** Event codes are short URL-safe slugs. */
const CODE = /^[a-z0-9][a-z0-9_-]{3,31}$/;

/**
 * Pull the event code out of whatever a guest scanned or typed:
 *   https://example.com/join/abc123   (the printed QR)
 *   https://example.com/open/abc123   (the "open in app" hand-off page)
 *   snapshare://join/abc123
 *   abc123
 * Returns null when it isn't a SnapShare join link.
 */
export function parseJoinCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const link = text.match(/(?:^|\/)(?:join|open)\/([A-Za-z0-9_-]+)(?:[/?#]|$)/);
  const candidate = (link?.[1] ?? (/^[A-Za-z0-9_-]+$/.test(text) ? text : "")).toLowerCase();
  return CODE.test(candidate) ? candidate : null;
}

/**
 * Host invites are sent as dashboard links (…/host/#/invite/<token>); accept the link or the bare token.
 */
export function parseInviteToken(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const link = text.match(/invite\/([A-Za-z0-9._~-]+)/);
  if (link) return link[1]!;
  return /^[A-Za-z0-9._~-]{16,200}$/.test(text) ? text : null;
}

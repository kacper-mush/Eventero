// Extracts @mentions from a chat message body.
//
// A "username" here is the local-part of a user's email (everything before
// the @) — Eventero has no separate username column, and inside a group
// (which is always small) the local-part is a reasonable handle.
//
// Match rules:
//   * Must be preceded by start-of-string or a non-word char so we don't
//     match the @ inside an email address.
//   * Username chars: letters, digits, dot, underscore, hyphen, plus.
//   * Returns lower-cased, de-duplicated usernames in first-seen order.

const MENTION_RE = /(?:^|[^A-Za-z0-9._+-])@([A-Za-z0-9._+-]+)/g;

export function parseMentions(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(MENTION_RE)) {
    // Strip trailing punctuation so "@bob." captures "bob".
    const raw = match[1]?.replace(/[.\-_+]+$/, "");
    const handle = raw?.toLowerCase();
    if (!handle) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

export function emailToHandle(email: string): string {
  const at = email.indexOf("@");
  return (at > 0 ? email.slice(0, at) : email).toLowerCase();
}

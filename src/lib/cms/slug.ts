// Slugs become public URLs (/to-observe-and-report/<slug>/). They are chosen once
// and locked at first publish, so rules are strict and predictable.
export const SLUG_MIN = 3;
export const SLUG_MAX = 80;
const SLUG_RX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= SLUG_MIN && value.length <= SLUG_MAX && SLUG_RX.test(value);
}

/** "Fun Dining in the Big Apple!" -> "fun-dining-in-the-big-apple" */
export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['’]/g, '') // "Pras's" -> "prass", not "pras-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let slug = base.slice(0, SLUG_MAX).replace(/-+$/g, '');
  if (slug.length < SLUG_MIN) slug = slug ? `${slug}-story`.slice(0, SLUG_MAX) : 'story';
  return slug;
}

/** First free slug: base, base-2, base-3, … `isTaken` covers DB rows and legacy slugs. */
export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean> | boolean): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '') + suffix;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error('Could not find a free slug.');
}

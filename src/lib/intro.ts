// Which text sits under an article's title as its italic intro, and which
// body paragraph (if any) was lifted out to serve as it. Shared by the public
// page (ArticlePage.astro) and the admin Preview so the two always agree.
//
// - A subtitle, when written, is the intro.
// - Stories written in the admin (source 'cms') get an intro ONLY from their
//   Subtitle box: with it empty, there's no intro and the first paragraph stays
//   in the body where the writer put it.
// - Archived (legacy) articles have no subtitle field, so their first plain
//   paragraph keeps doubling as the intro, as it always has.

interface IntroBlock {
  type: string;
  text?: string;
  subhead?: boolean;
}

export interface IntroResult<B> {
  /** Text for the intro slot ('' when there is none). */
  intro: string;
  /** The body with the lifted paragraph (if any) removed. */
  blocks: B[];
  /** First plain paragraph, for meta descriptions when there's no intro. */
  firstParagraph: string;
}

const isPlainParagraph = (b: IntroBlock, dateline: string) =>
  b.type === 'p' && !b.subhead && b.text !== dateline;

export function pickIntro<B extends IntroBlock>(
  source: 'legacy' | 'cms',
  subtitle: string,
  blocks: B[],
  dateline: string,
): IntroResult<B> {
  const firstIdx = blocks.findIndex((b) => isPlainParagraph(b, dateline));
  const firstParagraph = firstIdx >= 0 ? (blocks[firstIdx].text ?? '') : '';
  const fromSubtitle = (subtitle ?? '').trim();
  if (fromSubtitle) return { intro: fromSubtitle, blocks, firstParagraph };
  if (source === 'cms' || firstIdx < 0) return { intro: '', blocks, firstParagraph };
  return { intro: firstParagraph, blocks: blocks.filter((_, i) => i !== firstIdx), firstParagraph };
}

// Pre-process an article's flat block list into a render sequence
// of paragraphs and grouped figure compositions.

/**
 * @typedef {{ type: 'paragraph', text: string, subhead?: boolean, dateline?: boolean }} ParagraphItem
 * @typedef {{ type: 'figure', files: { file: string; alt: string }[], variant: 'single'|'pair'|'cluster' }} FigureItem
 */

const MAX_CLUSTER = 6; // cap displayed images in a cluster

/**
 * @param {Array} blocks  article blocks from content.json
 * @param {string} dateline  the article's verbatim dateline (may appear mid-flow)
 * @returns {Array<ParagraphItem|FigureItem>}
 */
export function renderSequence(blocks, dateline = '') {
  /** @type {Array<ParagraphItem|FigureItem>} */
  const out = [];
  let i = 0;

  while (i < blocks.length) {
    const b = blocks[i];

    if (b.type === 'p') {
      out.push({
        type: 'paragraph',
        text: b.text,
        subhead: !!b.subhead,
        dateline: b.text === dateline,
      });
      i++;
      continue;
    }

    // img — count consecutive images
    const imgs = [];
    while (i < blocks.length && blocks[i].type === 'img' && imgs.length < MAX_CLUSTER) {
      imgs.push({ file: blocks[i].file, alt: blocks[i].alt || '' });
      i++;
    }
    const len = imgs.length;
    const variant = len === 1 ? 'single' : len === 2 ? 'pair' : 'cluster';
    out.push({ type: 'figure', files: imgs, variant });
  }

  return out;
}
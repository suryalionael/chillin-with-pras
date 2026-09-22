// Pre-process an article's flat block list into a render sequence
// of paragraphs, figure compositions, and pass-through CMS blocks.

/**
 * @typedef {{ type: 'paragraph', text: string, subhead?: boolean, dateline?: boolean, inline?: Array }} ParagraphItem
 * @typedef {{ type: 'figure', files: { file: string; alt: string }[], variant: 'single'|'pair'|'cluster' }} FigureItem
 * @typedef {{ type: 'figure', files: { imageId: string; alt: string; caption: string; decorative: boolean; size: 'wide'|'inset' }[], variant: 'single'|'pair'|'cluster', isCms: true }} CmsFigureItem
 * @typedef {{ type: 'subheading', text: string, inline: Array }} SubheadingItem
 * @typedef {{ type: 'quote', paragraphs: Array<Array> }} QuoteItem
 * @typedef {{ type: 'list', ordered: boolean, items: Array<{ inline: Array, children: Array }> }} ListItem
 * @typedef {{ type: 'divider' }} DividerItem
 * @typedef {{ type: 'embed', url: string }} EmbedItem
 * @typedef { ParagraphItem | FigureItem | CmsFigureItem | SubheadingItem | QuoteItem | ListItem | DividerItem | EmbedItem } RenderItem
 */

const MAX_CLUSTER = 6; // cap displayed images in a cluster

/**
 * @param {Array} blocks  article blocks from content.json or CMS
 * @param {string} dateline  the article's verbatim dateline (may appear mid-flow)
 * @returns {Array<RenderItem>}
 */
export function renderSequence(blocks, dateline = '') {
  /** @type {Array<RenderItem>} */
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
        inline: b.inline,
      });
      i++;
      continue;
    }

    if (b.type === 'img') {
      // count consecutive images
      const imgs = [];
      while (i < blocks.length && blocks[i].type === 'img' && imgs.length < MAX_CLUSTER) {
        const img = blocks[i];
        if (img.source === 'cms') {
          imgs.push({
            imageId: img.imageId,
            alt: img.alt,
            caption: img.caption,
            decorative: img.decorative,
            size: img.size,
          });
        } else {
          imgs.push({ file: img.file, alt: img.alt || '' });
        }
        i++;
      }
      const len = imgs.length;
      if (len > 0) {
        const first = imgs[0];
        const isCms = 'imageId' in first;
        const variant = len === 1 ? 'single' : len === 2 ? 'pair' : 'cluster';
        if (isCms) {
          out.push({ type: 'figure', files: imgs, variant, isCms: true });
        } else {
          out.push({ type: 'figure', files: imgs, variant });
        }
      }
      continue;
    }

    // CMS-only block types pass through unchanged
    switch (b.type) {
      case 'subheading':
        out.push({ type: 'subheading', text: b.text, inline: b.inline });
        break;
      case 'quote':
        out.push({ type: 'quote', paragraphs: b.paragraphs });
        break;
      case 'list':
        out.push({ type: 'list', ordered: b.ordered, items: b.items });
        break;
      case 'divider':
        out.push({ type: 'divider' });
        break;
      case 'embed':
        out.push({ type: 'embed', url: b.url });
        break;
      default:
        // unknown block: skip (never loop forever)
        break;
    }
    i++;
  }

  return out;
}

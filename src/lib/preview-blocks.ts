// Client-side conversion from Tiptap/ProseMirror JSON to Article blocks for preview
// Mirrors src/lib/content/article.ts docToBlocks but runs in the browser

export interface InlineText {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}
export interface InlineBreak {
  br: true;
}
export type Inline = InlineText | InlineBreak;

export interface ParagraphBlock {
  type: 'p';
  text: string;
  subhead?: boolean;
  inline?: Inline[];
}
export interface CmsImageBlock {
  type: 'img';
  source: 'cms';
  imageId: string;
  alt: string;
  caption: string;
  decorative: boolean;
  size: 'wide' | 'inset';
}
export interface SubheadingBlock {
  type: 'subheading';
  text: string;
  inline: Inline[];
}
export interface ListItem {
  inline: Inline[];
  children: ListBlock[];
}
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
}
export interface QuoteBlock {
  type: 'quote';
  paragraphs: Inline[][];
}
export interface DividerBlock {
  type: 'divider';
}
export interface EmbedBlock {
  type: 'embed';
  url: string;
}

export type ArticleBlock =
  | ParagraphBlock
  | CmsImageBlock
  | SubheadingBlock
  | ListBlock
  | QuoteBlock
  | DividerBlock
  | EmbedBlock;

interface DocInline {
  type: 'text' | 'hardBreak';
  text?: string;
  marks?: Array<{ type: string; attrs?: { href?: string } }>;
}

function toInline(nodes: readonly DocInline[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ br: true });
      continue;
    }
    const t: InlineText = { text: n.text ?? '' };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') t.bold = true;
      else if (m.type === 'italic') t.italic = true;
      else if (m.type === 'link') t.href = m.attrs?.href;
    }
    out.push(t);
  }
  return out;
}

function plainText(inline: readonly Inline[]): string {
  return inline.map((i) => ('br' in i ? '\n' : i.text)).join('');
}

const isBlank = (inline: Inline[]) => plainText(inline).trim() === '';

type DocList = { type: 'bulletList' | 'orderedList'; content: readonly any[] };
type DocListItem = DocList['content'][number];

function toList(node: DocList): ListBlock {
  return {
    type: 'list',
    ordered: node.type === 'orderedList',
    items: node.content.map((item) => {
      const inline: Inline[] = [];
      const children: ListBlock[] = [];
      for (const child of item.content) {
        if (child.type === 'paragraph') {
          if (inline.length > 0) inline.push({ br: true });
          inline.push(...toInline(child.content));
        } else if (child.type === 'bulletList' || child.type === 'orderedList') {
          children.push(toList(child));
        }
      }
      return { inline, children };
    }),
  };
}

export function docToBlocks(doc: any): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  for (const b of doc.body?.content ?? []) {
    switch (b.type) {
      case 'paragraph': {
        const inline = toInline(b.content);
        if (!isBlank(inline)) blocks.push({ type: 'p', text: plainText(inline), inline });
        break;
      }
      case 'heading': {
        const inline = toInline(b.content);
        if (isBlank(inline)) break;
        if (b.attrs.level === 2) {
          blocks.push({ type: 'p', text: plainText(inline), subhead: true, inline });
        } else {
          blocks.push({ type: 'subheading', text: plainText(inline), inline });
        }
        break;
      }
      case 'bulletList':
      case 'orderedList':
        blocks.push(toList(b));
        break;
      case 'blockquote':
        blocks.push({ type: 'quote', paragraphs: b.content.map((p: any) => toInline(p.content)).filter((p: Inline[]) => !isBlank(p)) });
        break;
      case 'horizontalRule':
        blocks.push({ type: 'divider' });
        break;
      case 'image':
        blocks.push({ type: 'img', source: 'cms', imageId: b.attrs.imageId, alt: b.attrs.alt, caption: b.attrs.caption, decorative: b.attrs.decorative, size: b.attrs.size });
        break;
      case 'embed':
        blocks.push({ type: 'embed', url: b.attrs.url });
        break;
    }
  }
  return blocks;
}
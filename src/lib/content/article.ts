// The boundary between where content COMES FROM and how it is RENDERED.
//
//   legacy  src/data/site.json ──┐
//                                ├─►  Article  ─►  ArticlePage (one public renderer)
//   CMS     published snapshot ──┘
//
// Both sources convert into the same `Article` model. The public templates should
// only ever see `Article`; they must not know whether it came from JSON or D1.
//
// The legacy block shapes are preserved exactly (`p`, `img` + `subhead`) so the
// existing renderer keeps working untouched. CMS-only concepts are additive block
// types (`subheading`, `quote`, `list`, `divider`, `embed`), inline formatting
// (`inline`), and CMS-hosted images (`img` with `source: 'cms'`).
//
// NOTE for the future public-renderer phase: the current renderSequence() in
// src/lib/render.mjs only understands `p` and legacy `img`. It must be extended
// (and Photo.astro taught about `source: 'cms'`) before a CMS Article is passed to it.
import type { Block as DocBlock, StoryDocument } from '../cms/schema.ts';
import type { PublishedStory } from '../cms/db.ts';

export type Section = 'observe' | 'show';

// ---------- inline text ----------

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

// ---------- blocks ----------

export interface ParagraphBlock {
  type: 'p';
  text: string;
  /** legacy: a section heading rendered in the "subhead" style (a CMS level-2 heading maps here) */
  subhead?: boolean;
  /** CMS only: the same text with bold/italic/link formatting */
  inline?: Inline[];
}
export interface LegacyImageBlock {
  type: 'img';
  source?: 'legacy';
  /** filename under src/assets/images */
  file: string;
  alt: string;
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
  | LegacyImageBlock
  | CmsImageBlock
  | SubheadingBlock
  | ListBlock
  | QuoteBlock
  | DividerBlock
  | EmbedBlock;

export interface Article {
  source: 'legacy' | 'cms';
  /** public URL path, e.g. "/to-observe-and-report/the-wall/" */
  path: string;
  slug: string;
  section: Section;
  title: string;
  subtitle: string;
  /** entry number within its section (1-based) */
  order: number;
  /** the handwritten date line, e.g. "April 2012" */
  dateline: string;
  /** YYYY-MM-DD */
  dateISO: string;
  featuredImageId: string | null;
  blocks: ArticleBlock[];
}

export const SECTION_PATH: Record<Section, string> = {
  observe: '/to-observe-and-report/',
  show: '/to-show-and-tell/',
};

export const articlePath = (section: Section, slug: string): string => `${SECTION_PATH[section]}${slug}/`;

// ---------- legacy source ----------

interface RawLegacyBlock {
  type: string;
  text?: string;
  subhead?: boolean;
  file?: string;
  alt?: string;
}
interface RawLegacyArticle {
  path: string;
  slug: string;
  section: string;
  title: string;
  order: number;
  dateline?: string;
  dateISO?: string;
  blocks: RawLegacyBlock[];
}
export interface RawSite {
  articles: RawLegacyArticle[];
}

/** Converts the parsed contents of src/data/site.json. Block content is carried over unchanged. */
export function legacyArticles(site: RawSite): Article[] {
  return site.articles.map((a) => ({
    source: 'legacy' as const,
    path: a.path,
    slug: a.slug,
    section: a.section === 'show' ? 'show' : 'observe',
    title: a.title,
    subtitle: '',
    order: a.order,
    dateline: a.dateline ?? '',
    dateISO: a.dateISO ?? '',
    featuredImageId: null,
    blocks: a.blocks.map((b): ArticleBlock =>
      b.type === 'img'
        ? { type: 'img', file: b.file ?? '', alt: b.alt ?? '' }
        : { type: 'p', text: b.text ?? '', ...(b.subhead ? { subhead: true } : {}) },
    ),
  }));
}

// ---------- CMS source ----------

type DocInline = NonNullable<Extract<DocBlock, { type: 'paragraph' }>['content']>[number];

function toInline(nodes: readonly DocInline[] | undefined): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ br: true });
      continue;
    }
    const t: InlineText = { text: n.text };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') t.bold = true;
      else if (m.type === 'italic') t.italic = true;
      else if (m.type === 'link') t.href = m.attrs.href;
    }
    out.push(t);
  }
  return out;
}

export function plainText(inline: readonly Inline[]): string {
  return inline.map((i) => ('br' in i ? '\n' : i.text)).join('');
}

const isBlank = (inline: Inline[]) => plainText(inline).trim() === '';

type DocList = Extract<DocBlock, { type: 'bulletList' | 'orderedList' }>;
type DocListItem = DocList['content'][number];

function toList(node: { type: 'bulletList' | 'orderedList'; content: readonly DocListItem[] }): ListBlock {
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
        } else {
          children.push(toList(child as { type: 'bulletList' | 'orderedList'; content: readonly DocListItem[] }));
        }
      }
      return { inline, children };
    }),
  };
}

export function docToBlocks(doc: StoryDocument): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  for (const b of doc.body.content) {
    switch (b.type) {
      case 'paragraph': {
        const inline = toInline(b.content);
        if (!isBlank(inline)) blocks.push({ type: 'p', text: plainText(inline), inline });
        break;
      }
      case 'heading': {
        const inline = toInline(b.content);
        if (isBlank(inline)) break;
        // level 2 = the site's existing section-heading style; level 3 = a smaller subheading
        blocks.push(b.attrs.level === 2 ? { type: 'p', text: plainText(inline), subhead: true, inline } : { type: 'subheading', text: plainText(inline), inline });
        break;
      }
      case 'bulletList':
      case 'orderedList':
        blocks.push(toList(b));
        break;
      case 'blockquote':
        blocks.push({ type: 'quote', paragraphs: b.content.map((p) => toInline(p.content)).filter((p) => !isBlank(p)) });
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09-20" -> "September 20, 2026" (the same style as the legacy "May 28, 2012"). */
export function formatDateline(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return dateISO;
  return `${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}, ${m[1]}`;
}

export function publishedToArticle(story: PublishedStory, order: number): Article {
  const doc = story.document;
  return {
    source: 'cms',
    path: articlePath(story.section, story.slug),
    slug: story.slug,
    section: story.section,
    title: doc.title,
    subtitle: doc.subtitle,
    order,
    dateline: doc.dateline.trim() !== '' ? doc.dateline : formatDateline(story.publishedAt),
    dateISO: story.publishedAt,
    featuredImageId: doc.featuredImageId,
    blocks: docToBlocks(doc),
  };
}

// ---------- combining the two sources ----------

/**
 * Legacy articles keep their entry numbers. Published CMS stories continue each
 * section's numbering, oldest first. A CMS slug may never shadow a legacy one
 * (the public site resolves articles by slug), so a collision is a build error
 * rather than a silent override.
 */
export function assembleArticles(legacy: Article[], published: PublishedStory[]): Article[] {
  const taken = new Set(legacy.map((a) => a.slug));
  const next: Record<Section, number> = { observe: 0, show: 0 };
  for (const a of legacy) next[a.section] = Math.max(next[a.section], a.order);

  const cms: Article[] = [];
  const ordered = [...published].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));
  for (const story of ordered) {
    if (taken.has(story.slug)) throw new Error(`CMS story "${story.slug}" collides with an existing article slug.`);
    taken.add(story.slug);
    next[story.section] += 1;
    cms.push(publishedToArticle(story, next[story.section]));
  }
  return [...legacy, ...cms];
}

import { useMemo } from 'react';
import { pickIntro } from '../../lib/intro.ts';
import { docToBlocks } from '../../lib/preview-blocks.ts';
import type { ArticleBlock, Inline, CmsImageBlock, SubheadingBlock, ListBlock, ListItem, QuoteBlock, EmbedBlock } from '../../lib/preview-blocks.ts';
import { parseEmbedUrl } from '../../lib/content/embed-url.ts';
import type { StoryDocument } from '../../lib/cms/schema.ts';

interface PreviewRendererProps {
  doc: StoryDocument;
  title: string;
  subtitle: string;
  dateline: string;
  imageDims?: ImageDims;
}

function renderInline(inline: Inline[]): React.ReactNode {
  return inline.map((node, i) => {
    if ('br' in node) return <br key={i} />;
    const style: React.CSSProperties = {};
    if (node.bold) style.fontWeight = 600; // matches InlineContent.astro's public rendering
    if (node.italic) style.fontStyle = 'italic';
    if (node.href) {
      return (
        <a key={i} href={node.href} target="_blank" rel="noopener noreferrer" style={style}>
          {node.text}
        </a>
      );
    }
    return <span key={i} style={style}>{node.text}</span>;
  });
}

function PreviewParagraph({ block }: { block: ArticleBlock & { type: 'p' } }) {
  if (block.subhead) {
    return (
      <h2 className="prose__text subhead" style={{ marginTop: block.inline ? '4.5rem' : undefined }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
          <span style={{ flex: 'none', width: '3rem', height: '1px', background: 'var(--accent-warm)', transform: 'translateY(-0.25em)' }} />
          {block.inline ? renderInline(block.inline) : block.text}
        </span>
      </h2>
    );
  }
  // Poetry: the article subtitle's own italic typography (ArticleHeader's
  // .article-head__lead / ArticleBody's .prose__poetry on the public site).
  // Inline, not a class, matching this component's existing convention
  // (PreviewSubheading etc.) — nothing in the admin's own stylesheet defines
  // .prose__p at all, so a class here wouldn't connect to anything.
  const poetryStyle: React.CSSProperties | undefined = block.poetry
    ? { fontStyle: 'italic', fontSize: 'var(--fs-lead)', lineHeight: 1.65, color: 'var(--ink-soft)' }
    : undefined;
  return <p className="prose__text prose__p" style={poetryStyle}>{block.inline ? renderInline(block.inline) : block.text}</p>;
}

function PreviewSubheading({ block }: { block: SubheadingBlock }) {
  return <h3 className="prose__text" style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 600, lineHeight: 1.25, marginTop: '2rem', marginBottom: '1.75rem' }}>{renderInline(block.inline)}</h3>;
}

export type ImageDims = Record<string, { width: number; height: number }>;

// Mirrors Figure.astro (the public page) so Preview shows photographs the way
// they'll actually publish: each at its real aspect ratio (from the image's
// stored width/height), the writer's Standard/Wide choice for a lone photo, and
// consecutive photos grouped into a pair or a cluster exactly as render.mjs
// groups them. Styles live in editor.css under `.preview-prose .figure…`,
// copied from Figure.astro's scoped styles, which never reach the admin.
const MAX_CLUSTER = 6; // same cap as render.mjs
const FALLBACK_AR = 1.7778; // Figure.astro's fallback when dimensions are missing

function arOf(block: CmsImageBlock, dims: ImageDims): number {
  const d = dims[block.imageId];
  return d && d.width && d.height ? d.width / d.height : FALLBACK_AR;
}

function PreviewPhoto({ block, ar }: { block: CmsImageBlock; ar: number }) {
  return (
    <div className="photo-frame" style={{ '--ar': ar.toFixed(4) } as React.CSSProperties}>
      <img
        src={`/images/${block.imageId}/`}
        alt={block.decorative ? '' : block.alt}
        loading="lazy"
        decoding="async"
        className="photo"
      />
    </div>
  );
}

function PreviewFigure({ images, dims, hero = false }: { images: CmsImageBlock[]; dims: ImageDims; hero?: boolean }) {
  const variant = images.length === 1 ? 'single' : images.length === 2 ? 'pair' : 'cluster';
  const ar = (b: CmsImageBlock) => arOf(b, dims);
  const sum = (list: CmsImageBlock[]) => list.reduce((t, b) => t + ar(b), 0).toFixed(4);
  // Same tone rule as ArticleBody.astro: a lone CMS photo follows its own
  // size; pairs and clusters are always full width.
  const tone = variant === 'single' && images[0].size === 'inset' ? 'inset-right' : 'wide';

  const rows: CmsImageBlock[][] = [];
  if (variant === 'cluster') {
    const rest = images.slice(1);
    let i = 0;
    if (rest.length % 2 === 1 && rest.length >= 3 && rest.slice(0, 3).every((b) => ar(b) >= 1.15)) {
      rows.push(rest.slice(0, 3));
      i = 3;
    }
    for (; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
  }

  const figure = (
      <figure className={`figure figure--${variant} figure--${tone}${hero ? ' figure--hero' : ''}`}>
        {variant === 'single' && (
          <div className="figure__box" style={{ '--ar': ar(images[0]).toFixed(4) } as React.CSSProperties}>
            <PreviewPhoto block={images[0]} ar={ar(images[0])} />
            {images[0].caption && <figcaption className="figure__hand hand">{images[0].caption}</figcaption>}
          </div>
        )}
        {variant === 'pair' && (
          <div className="figure__row" style={{ '--sum': sum(images) } as React.CSSProperties}>
            {images.map((b, i) => <PreviewPhoto key={i} block={b} ar={ar(b)} />)}
          </div>
        )}
        {variant === 'cluster' && (
          <>
            <div className="figure__box" style={{ '--ar': ar(images[0]).toFixed(4) } as React.CSSProperties}>
              <PreviewPhoto block={images[0]} ar={ar(images[0])} />
            </div>
            {rows.map((row, r) => (
              <div
                key={r}
                className={`figure__row${row.length === 1 ? ' figure__row--solo' : ''}`}
                style={{ '--sum': sum(row) } as React.CSSProperties}
              >
                {row.map((b, i) => <PreviewPhoto key={i} block={b} ar={ar(b)} />)}
              </div>
            ))}
          </>
        )}
      </figure>
  );
  return hero ? <div className="story__hero">{figure}</div> : <div className="prose__figure">{figure}</div>;
}

function PreviewList({ block }: { block: ListBlock }) {
  const renderItems = (items: ListItem[], ordered: boolean, depth = 0): React.ReactNode => (
    <ul style={{ listStyle: ordered ? 'decimal' : 'disc', paddingLeft: '1.5rem', margin: '1rem 0' }}>
      {items.map((item, i) => (
        <li key={i} style={{ margin: '0.5rem 0' }}>
          {item.inline && renderInline(item.inline)}
          {item.children.map((child, j) => <div key={j}>{renderItems(child.items, child.ordered, depth + 1)}</div>)}
        </li>
      ))}
    </ul>
  );
  return renderItems(block.items, block.ordered);
}

function PreviewQuote({ block }: { block: QuoteBlock }) {
  return (
    <blockquote style={{ margin: '2rem 0', paddingLeft: '1.5rem', borderLeft: '3px solid var(--accent-warm)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>
      {block.paragraphs.map((p: Inline[], i: number) => (
        <p key={i} style={{ margin: 0 }}>{renderInline(p)}</p>
      ))}
    </blockquote>
  );
}

function PreviewDivider() {
  return <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '2.5rem 0' }} />;
}

function PreviewEmbed({ block }: { block: EmbedBlock }) {
  if (!block.url) return null;
  const parsed = parseEmbedUrl(block.url);
  if (parsed) {
    const boxStyle: React.CSSProperties = parsed.height
      ? { position: 'relative', margin: '2.5rem auto', maxWidth: '44rem', width: '100%', height: parsed.height, borderRadius: '2px', overflow: 'hidden' }
      : { position: 'relative', margin: '2.5rem auto', maxWidth: '44rem', width: '100%', paddingTop: '56.25%', background: '#000', borderRadius: '2px', overflow: 'hidden' };
    return (
      <div style={boxStyle}>
        <iframe
          src={parsed.embedSrc}
          title="Embedded content"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    );
  }
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'block', margin: '2rem auto', padding: '1.25rem 1.5rem', maxWidth: '42rem', background: 'var(--paper-deep)', border: '1px solid var(--line-strong)', borderRadius: '2px', fontFamily: 'var(--sans)', color: 'var(--accent-warm)', textDecoration: 'none', wordBreak: 'break-word' }}
    >
      {block.url}
    </a>
  );
}

export function PreviewRenderer({ doc, title, subtitle, dateline, imageDims = {} }: PreviewRendererProps) {
  // Same reading order as ArticlePage.astro: the intro comes only from the
  // Subtitle box (lib/intro.ts, shared with the public page), then the first
  // photograph, if it sits near the top (index <= 8), is lifted out into the
  // hero slot under the title.
  const { intro, hero, blocks } = useMemo(() => {
    const picked = pickIntro('cms', subtitle, docToBlocks(doc), dateline);
    let body = picked.blocks;
    const firstImg = body.findIndex((b) => b.type === 'img');
    const hero = firstImg >= 0 && firstImg <= 8 ? (body[firstImg] as CmsImageBlock) : null;
    if (hero) body = body.filter((_, i) => i !== firstImg);
    return { intro: picked.intro, hero, blocks: body };
  }, [doc, subtitle, dateline]);

  // Group runs of consecutive photos (up to MAX_CLUSTER) into one figure, the
  // way render.mjs does for the public page; everything else renders as-is.
  const items = useMemo(() => {
    const out: (ArticleBlock | { type: 'figure'; images: CmsImageBlock[] })[] = [];
    for (let i = 0; i < blocks.length; ) {
      const b = blocks[i];
      if (b.type === 'img') {
        const images: CmsImageBlock[] = [];
        while (i < blocks.length && blocks[i].type === 'img' && images.length < MAX_CLUSTER) {
          images.push(blocks[i] as CmsImageBlock);
          i++;
        }
        out.push({ type: 'figure', images });
      } else {
        out.push(b);
        i++;
      }
    }
    return out;
  }, [blocks]);

  return (
    <article className="container story preview-article">
      <header className="preview-header">
        <p className="admin-kicker" style={{ marginBottom: '0.5rem' }}>Preview</p>
        <h1 className="preview-title">{title || 'Untitled story'}</h1>
        {dateline && <p className="preview-dateline hand-date" style={{ marginTop: '1rem', textAlign: 'right' }}>{dateline}</p>}
        {intro && <p className="preview-lead">{intro}</p>}
      </header>

      {hero && <PreviewFigure images={[hero]} dims={imageDims} hero />}

      <div className="prose preview-prose">
        {items.map((block, i) => {
          switch (block.type) {
            case 'p':
              return <PreviewParagraph key={i} block={block} />;
            case 'subheading':
              return <PreviewSubheading key={i} block={block} />;
            case 'figure':
              return <PreviewFigure key={i} images={block.images} dims={imageDims} />;
            case 'list':
              return <PreviewList key={i} block={block} />;
            case 'quote':
              return <PreviewQuote key={i} block={block} />;
            case 'divider':
              return <PreviewDivider key={i} />;
            case 'embed':
              return <PreviewEmbed key={i} block={block} />;
            default:
              return null;
          }
        })}
      </div>
    </article>
  );
}
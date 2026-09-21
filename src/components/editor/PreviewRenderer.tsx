import { useMemo } from 'react';
import { docToBlocks, ArticleBlock, Inline, CmsImageBlock } from '../../lib/preview-blocks.ts';

interface PreviewRendererProps {
  doc: any;
  title: string;
  subtitle: string;
  dateline: string;
}

function renderInline(inline: Inline[]): React.ReactNode {
  return inline.map((node, i) => {
    if ('br' in node) return <br key={i} />;
    const style: React.CSSProperties = {};
    if (node.bold) style.fontWeight = 700;
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
  return <p className="prose__text prose__p">{block.inline ? renderInline(block.inline) : block.text}</p>;
}

function PreviewSubheading({ block }: { block: SubheadingBlock }) {
  return <h3 className="prose__text" style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 600, lineHeight: 1.25, marginTop: '2rem', marginBottom: '1.75rem' }}>{renderInline(block.inline)}</h3>;
}

function PreviewImage({ block }: { block: CmsImageBlock }) {
  const imageUrl = `/images/${block.imageId}`;
  const tone = block.size === 'inset' ? 'inset-right' : 'wide';
  return (
    <div className="prose__figure">
      <figure className={`figure figure--single figure--${tone}`}>
        <div className="figure__box" style={{ width: 'min(100%, calc(var(--ar) * var(--cap)))', marginInline: 'auto' }}>
          <div className="photo-frame" style={{ '--ar': '16 / 9' }}>
            <img
              src={imageUrl}
              alt={block.decorative ? '' : block.alt}
              loading="lazy"
              decoding="async"
              className="photo"
              style={{ aspectRatio: '16 / 9' }}
            />
          </div>
          {block.caption && <figcaption className="figure__hand hand">{block.caption}</figcaption>}
        </div>
      </figure>
    </div>
  );
}

function PreviewList({ block }: { block: ListBlock }) {
  const renderItems = (items: any[], depth = 0) => (
    <ul style={{ listStyle: block.ordered ? 'decimal' : 'disc', paddingLeft: depth > 0 ? '1.5rem' : '1.5rem', margin: '1rem 0' }}>
      {items.map((item, i) => (
        <li key={i} style={{ margin: '0.5rem 0' }}>
          {item.inline && renderInline(item.inline)}
          {item.children.length > 0 && renderItems(item.children.map(c => ({ ordered: c.ordered, items: c.items })), depth + 1)}
        </li>
      ))}
    </ul>
  );
  return renderItems(block.items);
}

function PreviewQuote({ block }: { block: QuoteBlock }) {
  return (
    <blockquote style={{ margin: '2rem 0', paddingLeft: '1.5rem', borderLeft: '3px solid var(--accent-warm)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>
      {block.paragraphs.map((p, i) => (
        <p key={i} style={{ margin: 0 }}>{renderInline(p)}</p>
      ))}
    </blockquote>
  );
}

function PreviewDivider() {
  return <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '2.5rem 0' }} />;
}

function PreviewEmbed({ block }: { block: EmbedBlock }) {
  return (
    <div style={{ margin: '2rem auto', padding: '2rem', maxWidth: '42rem', background: 'var(--paper-deep)', border: '1px dashed var(--line-strong)', borderRadius: '2px', textAlign: 'center', fontFamily: 'var(--sans)', color: 'var(--ink-soft)' }}>
      Embed: {block.url || '(enter URL)'}
    </div>
  );
}

export function PreviewRenderer({ doc, title, subtitle, dateline }: PreviewRendererProps) {
  const blocks = useMemo(() => docToBlocks(doc), [doc]);

  return (
    <article className="container story preview-article">
      <header className="preview-header">
        <p className="admin-kicker" style={{ marginBottom: '0.5rem' }}>Preview</p>
        <h1 className="preview-title">{title || 'Untitled story'}</h1>
        {subtitle && <p className="preview-subtitle">{subtitle}</p>}
        {dateline && <p className="preview-dateline hand-date" style={{ marginTop: '1rem', textAlign: 'right' }}>{dateline}</p>}
      </header>

      <div className="prose preview-prose">
        {blocks.map((block, i) => {
          switch (block.type) {
            case 'p':
              return <PreviewParagraph key={i} block={block} />;
            case 'subheading':
              return <PreviewSubheading key={i} block={block} />;
            case 'img':
              return <PreviewImage key={i} block={block} />;
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
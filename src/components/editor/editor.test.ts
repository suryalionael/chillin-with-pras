import { describe, it } from 'node:test';
import assert from 'node:assert';
import { docToBlocks } from '../../lib/preview-blocks.ts';
import type { StoryDocument } from '../../lib/cms/schema.ts';

describe('editor document serialization', () => {
  const baseDoc: StoryDocument = {
    version: 1,
    title: 'Test Story',
    subtitle: 'A test subtitle',
    dateline: 'September 2026',
    featuredImageId: null,
    body: { type: 'doc', content: [] },
  };

  it('serializes paragraphs correctly', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'p');
    assert.strictEqual((blocks[0] as any).text, 'Hello world');
  });

  it('serializes bold and italic inline marks', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.ok(blocks[0].inline);
    assert.deepStrictEqual(blocks[0].inline![0], { text: 'Bold ', bold: true });
    assert.deepStrictEqual(blocks[0].inline![1], { text: 'italic', italic: true });
  });

  it('serializes links', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.deepStrictEqual(blocks[0].inline![0], { text: 'Link', href: 'https://example.com' });
  });

  it('serializes headings level 2 as subhead paragraphs', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading 2' }] },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'p');
    assert.strictEqual((blocks[0] as any).subhead, true);
    assert.strictEqual((blocks[0] as any).text, 'Heading 2');
  });

  it('serializes headings level 3 as subheading blocks', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Heading 3' }] },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'subheading');
    assert.strictEqual((blocks[0] as any).text, 'Heading 3');
  });

  it('serializes bullet lists', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] },
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }] },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'list');
    assert.strictEqual((blocks[0] as any).ordered, false);
    assert.strictEqual((blocks[0] as any).items.length, 2);
  });

  it('serializes ordered lists', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            content: [
              { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'list');
    assert.strictEqual((blocks[0] as any).ordered, true);
  });

  it('serializes blockquotes', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'A quote' }] },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'quote');
    assert.strictEqual((blocks[0] as any).paragraphs.length, 1);
  });

  it('serializes horizontal rules as dividers', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          { type: 'horizontalRule' },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'divider');
  });

  it('serializes images with all attributes', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              imageId: 'abc-123',
              alt: 'Alt text',
              caption: 'Caption',
              decorative: false,
              size: 'wide',
            },
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'img');
    assert.strictEqual((blocks[0] as any).source, 'cms');
    assert.strictEqual((blocks[0] as any).imageId, 'abc-123');
    assert.strictEqual((blocks[0] as any).alt, 'Alt text');
    assert.strictEqual((blocks[0] as any).caption, 'Caption');
    assert.strictEqual((blocks[0] as any).decorative, false);
    assert.strictEqual((blocks[0] as any).size, 'wide');
  });

  it('serializes embeds', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          { type: 'embed', attrs: { url: 'https://example.com/video' } },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'embed');
    assert.strictEqual((blocks[0] as any).url, 'https://example.com/video');
  });

  it('skips empty paragraphs', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Not empty' }] },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual((blocks[0] as any).text, 'Not empty');
  });

  it('handles nested lists', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
                  {
                    type: 'bulletList',
                    content: [
                      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.strictEqual(blocks[0].type, 'list');
    assert.strictEqual((blocks[0] as any).items[0].children.length, 1);
    assert.strictEqual((blocks[0] as any).items[0].children[0].type, 'list');
    assert.strictEqual((blocks[0] as any).items[0].children[0].ordered, false);
  });

  it('converts hard breaks to inline breaks', () => {
    const doc: StoryDocument = {
      ...baseDoc,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Line 1' },
              { type: 'hardBreak' },
              { type: 'text', text: 'Line 2' },
            ],
          },
        ],
      },
    };
    const blocks = docToBlocks(doc);
    assert.ok(blocks[0].inline);
    const inline = blocks[0].inline!;
    assert.ok(inline.some((i) => 'br' in i));
  });
});
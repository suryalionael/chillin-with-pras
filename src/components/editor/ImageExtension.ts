import { Node, mergeAttributes } from '@tiptap/core';

export interface ImageOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        imageId: string;
        alt: string;
        caption: string;
        decorative: boolean;
        size: 'wide' | 'inset';
      }) => ReturnType;
    };
  }
}

export const Image = Node.create<ImageOptions>({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      imageId: { default: null, renderHTML: (attributes) => ({ 'data-image-id': attributes.imageId }) },
      alt: { default: '', renderHTML: (attributes) => ({ alt: attributes.alt }) },
      caption: { default: '', renderHTML: () => ({}) },
      decorative: { default: false, renderHTML: (attributes) => ({ 'data-decorative': attributes.decorative }) },
      size: { default: 'wide', renderHTML: (attributes) => ({ 'data-size': attributes.size }) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-image-id]', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    const { imageId, alt, caption, decorative, size, ...rest } = HTMLAttributes;
    return [
      'div',
      mergeAttributes({ class: `editor-image editor-image--${size}`, 'data-image-id': imageId, 'data-decorative': decorative }, rest),
      [
        'div',
        { class: 'editor-image__wrapper' },
        ['div', { class: 'editor-image__placeholder' }, `Image: ${imageId || '(select image)'}`],
        caption ? ['figcaption', { class: 'editor-image__caption' }, caption] : null,
      ],
    ];
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: 'image',
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const div = document.createElement('div');
      div.className = `editor-image editor-image--${node.attrs.size}`;
      div.setAttribute('data-image-id', node.attrs.imageId);
      div.setAttribute('data-decorative', String(node.attrs.decorative));
      div.innerHTML = `
        <div class="editor-image__wrapper">
          <div class="editor-image__placeholder">Image: ${node.attrs.imageId || '(select image)'}</div>
          ${node.attrs.caption ? `<figcaption class="editor-image__caption">${node.attrs.caption}</figcaption>` : ''}
        </div>
      `;
      div.contentEditable = 'false';
      return { dom: div, update: () => false };
    };
  },
});
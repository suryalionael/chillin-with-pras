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
        imageId ? ['img', { class: 'editor-image__img', src: `/images/${imageId}`, alt: decorative ? '' : alt || '' }] : ['div', { class: 'editor-image__placeholder' }, '(select image)'],
      ],
      caption ? ['figcaption', { class: 'editor-image__caption' }, caption] : null,
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
      let current = node;

      const dom = document.createElement('div');
      dom.contentEditable = 'false';

      const wrapper = document.createElement('div');
      wrapper.className = 'editor-image__wrapper';

      const img = document.createElement('img');
      img.className = 'editor-image__img';
      img.loading = 'lazy';
      wrapper.appendChild(img);

      const caption = document.createElement('textarea');
      caption.className = 'editor-image__caption editor-image__caption--input';
      caption.placeholder = 'Type a caption (optional)';
      caption.rows = 1;

      const autoGrow = () => {
        caption.style.height = 'auto';
        caption.style.height = `${caption.scrollHeight}px`;
      };

      const commitCaption = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null || caption.value === current.attrs.caption) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, caption: caption.value }));
      };

      caption.addEventListener('input', autoGrow);
      caption.addEventListener('blur', commitCaption);
      caption.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          caption.blur();
        } else if (e.key === 'Escape') {
          caption.value = current.attrs.caption || '';
          caption.blur();
        }
      });

      const apply = (n: typeof node) => {
        dom.className = `editor-image editor-image--${n.attrs.size}`;
        dom.setAttribute('data-image-id', n.attrs.imageId ?? '');
        dom.setAttribute('data-decorative', String(n.attrs.decorative));
        img.src = n.attrs.imageId ? `/images/${n.attrs.imageId}` : '';
        img.alt = n.attrs.decorative ? '' : n.attrs.alt || '';
        if (document.activeElement !== caption) caption.value = n.attrs.caption || '';
      };

      apply(node);
      dom.appendChild(wrapper);
      dom.appendChild(caption);
      requestAnimationFrame(autoGrow);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false;
          current = updatedNode;
          apply(updatedNode);
          return true;
        },
        stopEvent: (event) => event.target === caption,
        ignoreMutation: () => true,
      };
    };
  },
});

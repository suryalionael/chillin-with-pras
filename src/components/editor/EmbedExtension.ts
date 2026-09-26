import { Node, mergeAttributes } from '@tiptap/core';
import { parseEmbedUrl } from '../../lib/content/embed-url.ts';

export interface EmbedOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (options: { url: string }) => ReturnType;
    };
  }
}

export const Embed = Node.create<EmbedOptions>({
  name: 'embed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: { default: '', renderHTML: (attributes) => ({ 'data-url': attributes.url }) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-embed]', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    const url = HTMLAttributes.url as string;
    const parsed = url ? parseEmbedUrl(url) : null;
    return [
      'div',
      mergeAttributes({ 'data-embed': '', 'data-url': url, class: 'editor-embed' }),
      parsed
        ? ['div', { class: 'editor-embed__frame' }, ['iframe', { src: parsed.embedSrc, title: 'Embedded content', loading: 'lazy' }]]
        : ['div', { class: 'editor-embed__placeholder' }, url ? `Embed: ${url}` : '(paste a link)'],
    ];
  },

  addCommands() {
    return {
      setEmbed:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: 'embed',
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

      let activeInput: HTMLInputElement | null = null;

      const render = (n: typeof node) => {
        dom.className = 'editor-embed';
        dom.setAttribute('data-url', n.attrs.url ?? '');
        dom.innerHTML = '';
        activeInput = null;

        const parsed = n.attrs.url ? parseEmbedUrl(n.attrs.url) : null;
        if (parsed) {
          dom.classList.add('editor-embed--live');
          const frame = document.createElement('div');
          frame.className = 'editor-embed__frame';
          const iframe = document.createElement('iframe');
          iframe.src = parsed.embedSrc;
          iframe.loading = 'lazy';
          iframe.title = 'Embedded content';
          iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          iframe.allowFullscreen = true;
          frame.appendChild(iframe);
          dom.appendChild(frame);
          return;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'editor-embed__input';
        input.placeholder = 'Paste a YouTube or Vimeo link, then press Enter';
        input.value = n.attrs.url ?? '';
        const commit = () => {
          const value = input.value.trim();
          if (!value || value === current.attrs.url) return;
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, url: value }));
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        });
        input.addEventListener('blur', commit);
        dom.appendChild(input);
        activeInput = input;
        if (!n.attrs.url) requestAnimationFrame(() => input.focus());
      };

      render(node);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'embed') return false;
          current = updatedNode;
          render(updatedNode);
          return true;
        },
        stopEvent: (event) => event.target === activeInput,
        ignoreMutation: () => true,
      };
    };
  },
});

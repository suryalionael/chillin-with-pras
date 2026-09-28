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
      // Once a link resolves to a live player there was previously no way back
      // to the input — a typo or the wrong link was permanent short of
      // deleting the whole block. `editing` reopens the input on demand via
      // the "Change link" button, independent of whether a URL is already set.
      let editing = !node.attrs.url;

      const dom = document.createElement('div');
      dom.contentEditable = 'false';

      let activeInput: HTMLInputElement | null = null;
      let editButton: HTMLButtonElement | null = null;

      const render = (n: typeof node) => {
        dom.className = 'editor-embed';
        dom.setAttribute('data-url', n.attrs.url ?? '');
        dom.innerHTML = '';
        activeInput = null;
        editButton = null;

        const parsed = n.attrs.url ? parseEmbedUrl(n.attrs.url) : null;
        if (parsed && !editing) {
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

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'editor-embed__edit';
          btn.setAttribute('aria-label', 'Change link');
          btn.title = 'Change link';
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            editing = true;
            render(current);
          });
          frame.appendChild(btn);
          editButton = btn;

          dom.appendChild(frame);
          return;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'editor-embed__input';
        input.placeholder = 'Paste a YouTube or Vimeo link, then press Enter';
        input.value = n.attrs.url ?? '';
        const cancelToLive = () => {
          if (!parsed) return false;
          editing = false;
          render(current);
          return true;
        };
        const commit = () => {
          const value = input.value.trim();
          if (!value) {
            cancelToLive();
            return;
          }
          if (value === current.attrs.url) {
            cancelToLive();
            return;
          }
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null) return;
          editing = false;
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, url: value }));
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            input.value = current.attrs.url ?? '';
            if (!cancelToLive()) input.blur();
          }
        });
        input.addEventListener('blur', commit);
        dom.appendChild(input);
        activeInput = input;
        requestAnimationFrame(() => input.focus());
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
        stopEvent: (event) =>
          event.target === activeInput ||
          (event.target instanceof Element && editButton != null && editButton.contains(event.target)),
        ignoreMutation: () => true,
      };
    };
  },
});

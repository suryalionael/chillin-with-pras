import { Node, mergeAttributes } from '@tiptap/core';

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
    return [
      'div',
      mergeAttributes({ 'data-embed': '', 'data-url': HTMLAttributes.url, class: 'editor-embed' }),
      ['div', { class: 'editor-embed__placeholder' }, `Embed: ${HTMLAttributes.url || '(enter URL)'}`],
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
      const div = document.createElement('div');
      div.className = 'editor-embed';
      div.setAttribute('data-url', node.attrs.url);
      div.innerHTML = `<div class="editor-embed__placeholder">Embed: ${node.attrs.url || '(enter URL)'}</div>`;
      div.contentEditable = 'false';
      return { dom: div, update: () => false };
    };
  },
});
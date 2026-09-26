import type { Editor } from '@tiptap/core';

export interface SlashCommandProps {
  editor: Editor;
  range: { from: number; to: number };
}

/**
 * The subset of @tiptap/suggestion's SuggestionProps this menu actually
 * reads. The real SuggestionProps also carries FloatingUI internals (flip,
 * mount, loading, ...) that only the plugin itself needs — accepting the
 * narrower shape here lets the menu be driven standalone (the "+" button)
 * without fabricating those. A real SuggestionProps is structurally
 * assignable to this (it's a superset), so the Suggestion plugin's own
 * onStart/onUpdate/onKeyDown callbacks pass straight through.
 */
export interface SlashMenuProps {
  editor: Editor;
  range: { from: number; to: number };
  query: string;
}

interface SlashMenuItem {
  title: string;
  command?: (props: SlashCommandProps) => void;
  /** raw SVG/HTML markup — this menu is rendered via innerHTML, not React, so icons must be strings, not JSX */
  icon: string;
  action?: 'insert' | 'image-picker';
}

export const SLASH_ITEMS: SlashMenuItem[] = [
  { title: 'Paragraph', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(), icon: '<span>¶</span>' },
  { title: 'Heading', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(), icon: '<span>H1</span>' },
  { title: 'Subheading', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(), icon: '<span>H2</span>' },
  { title: 'Quote', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setBlockquote().run(), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"/></svg>' },
  { title: 'Bulleted list', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><line x1="4" y1="6" x2="4.01" y2="6"/><line x1="4" y1="12" x2="4.01" y2="12"/><line x1="4" y1="18" x2="4.01" y2="18"/></svg>' },
  { title: 'Numbered list', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="4" y="10" font-size="12" text-anchor="middle" fill="currentColor">1</text><text x="4" y="16" font-size="12" text-anchor="middle" fill="currentColor">2</text><text x="4" y="22" font-size="12" text-anchor="middle" fill="currentColor">3</text></svg>' },
  { title: 'Divider', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/></svg>' },
  { title: 'Image', action: 'image-picker', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  { title: 'Embed', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setEmbed({ url: '' }).run(), icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><polyline points="17 2 22 2 22 7"/><path d="M12 22 7 17 12 12 17 17 12 22"/></svg>' },
];

export class SlashMenu {
  private props: SlashMenuProps | null = null;
  private element: HTMLDivElement | null = null;
  private selectedIndex = 0;
  private filter = '';
  private onImagePickerRequest: (range: { from: number; to: number }) => void = () => {};
  private onDestroy: () => void = () => {};

  constructor(props: SlashMenuProps) {
    this.props = props;
    this.createElement();
    this.update(props);
  }

  setOnImagePickerRequest(cb: (range: { from: number; to: number }) => void) {
    this.onImagePickerRequest = cb;
  }

  /**
   * Fires whenever this menu instance goes away, for whatever reason (an item
   * picked, Escape, clicking outside). A caller driving the menu standalone
   * (not through the Suggestion plugin's own onExit) needs this to know its
   * reference to the menu is now stale — otherwise nothing ever tells it the
   * menu closed itself, and it can end up holding a dangling instance forever.
   */
  setOnDestroy(cb: () => void) {
    this.onDestroy = cb;
  }

  get el(): HTMLElement | null {
    return this.element;
  }

  getQuery(): string {
    return this.filter;
  }

  private createElement() {
    this.element = document.createElement('div');
    this.element.className = 'slash-menu';
    this.element.setAttribute('role', 'listbox');
    this.element.setAttribute('aria-label', 'Insert block');
    document.body.appendChild(this.element);
  }

  update(props: SlashMenuProps) {
    this.props = props;
    this.filter = props.query.toLowerCase();
    this.selectedIndex = 0;
    this.render();
    this.position();
  }

  private getFilteredItems() {
    return SLASH_ITEMS.filter((item) => item.title.toLowerCase().includes(this.filter));
  }

  private render() {
    if (!this.element) return;
    const items = this.getFilteredItems();
    this.element.innerHTML = items
      .map((item, index) => `
        <div
          class="slash-menu__item ${index === this.selectedIndex ? 'selected' : ''}"
          role="option"
          aria-selected="${index === this.selectedIndex}"
          data-index="${index}"
          data-action="${item.action || 'insert'}"
          tabindex="-1"
        >
          <span class="slash-menu__icon">${item.icon ?? ''}</span>
          <span class="slash-menu__title">${item.title}</span>
        </div>
      `).join('');

    this.element.querySelectorAll('.slash-menu__item').forEach((el, index) => {
      // preventDefault stops the browser's default mousedown handling, which
      // otherwise blurs the (now-focusable-ancestor-less, about-to-be-removed)
      // menu item and steals focus back to <body> — undoing the .focus() the
      // selected command just ran on the editor and swallowing every
      // keystroke typed right after picking an item.
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.selectedIndex = index;
        this.selectItem();
      });
    });
  }

  private position() {
    if (!this.element || !this.props) return;
    const { editor, range } = this.props;
    if (!editor?.view) return;

    const coords = editor.view.coordsAtPos(range.from);
    this.element.style.left = `${coords.left}px`;
    this.element.style.top = `${coords.bottom + 4}px`;
  }

  // Note: this receives SuggestionKeyDownProps ({ view, event, range}), NOT
  // SuggestionProps — it must never overwrite this.props (which holds the
  // editor reference selectItem() needs), only read the key event off it.
  onKeyDown({ event }: { view: unknown; event: KeyboardEvent; range: { from: number; to: number } }): boolean {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const items = this.getFilteredItems();
      this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
      this.render();
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.render();
      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.selectItem();
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.destroy();
      return true;
    }

    return false;
  }

  private selectItem() {
    const items = this.getFilteredItems();
    const item = items[this.selectedIndex];
    if (item && this.props) {
      if (item.action === 'image-picker') {
        this.onImagePickerRequest(this.props.range);
      } else if (item.command) {
        item.command({ editor: this.props.editor, range: this.props.range });
      }
    }
    this.destroy();
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
      this.onDestroy();
    }
  }
}
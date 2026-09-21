import { SuggestionProps } from '@tiptap/suggestion';
import { useState, useRef, useEffect, useCallback } from 'react';

interface SlashMenuItem {
  title: string;
  command: (props: { editor: any; range: { from: number; to: number } }) => void;
  icon?: React.ReactNode;
}

const ITEMS: SlashMenuItem[] = [
  { title: 'Paragraph', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run(), icon: <span>¶</span> },
  { title: 'Heading', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(), icon: <span>H1</span> },
  { title: 'Subheading', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(), icon: <span>H2</span> },
  { title: 'Quote', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setBlockquote().run(), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"/></svg> },
  { title: 'Bulleted list', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><line x1="4" y1="6" x2="4.01" y2="6"/><line x1="4" y1="12" x2="4.01" y2="12"/><line x1="4" y1="18" x2="4.01" y2="18"/></svg> },
  { title: 'Numbered list', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="4" y="10" fontSize="12" textAnchor="middle" fill="currentColor">1</text><text x="4" y="16" fontSize="12" textAnchor="middle" fill="currentColor">2</text><text x="4" y="22" fontSize="12" textAnchor="middle" fill="currentColor">3</text></svg> },
  { title: 'Divider', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/></svg> },
  { title: 'Image', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setImage({ imageId: crypto.randomUUID(), alt: '', caption: '', decorative: false, size: 'wide' }).run(), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
  { title: 'Embed', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setEmbed({ url: '' }).run(), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><polyline points="17 2 22 2 22 7"/><path d="M12 22 7 17 12 12 17 17 12 22"/></svg> },
];

export class SlashMenu {
  private props: SuggestionProps | null = null;
  private element: HTMLDivElement | null = null;
  private selectedIndex = 0;
  private filter = '';
  private editorRef: any = null;

  constructor(props: SuggestionProps) {
    this.props = props;
    this.editorRef = props.editor;
    this.createElement();
    this.update(props);
  }

  private createElement() {
    this.element = document.createElement('div');
    this.element.className = 'slash-menu';
    this.element.setAttribute('role', 'listbox');
    this.element.setAttribute('aria-label', 'Insert block');
    document.body.appendChild(this.element);
  }

  update(props: SuggestionProps) {
    this.props = props;
    this.editorRef = props.editor;
    this.filter = props.query.toLowerCase();
    this.selectedIndex = 0;
    this.render();
    this.position();
  }

  private getFilteredItems() {
    return ITEMS.filter((item) => item.title.toLowerCase().includes(this.filter));
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
          tabindex="-1"
        >
          <span class="slash-menu__icon">${item.icon ?? ''}</span>
          <span class="slash-menu__title">${item.title}</span>
        </div>
      `).join('');

    this.element.querySelectorAll('.slash-menu__item').forEach((el, index) => {
      el.addEventListener('mousedown', () => {
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

  onKeyDown(props: SuggestionProps): boolean {
    this.props = props;
    this.editorRef = props.editor;

    if (props.event.key === 'ArrowDown') {
      props.event.preventDefault();
      const items = this.getFilteredItems();
      this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
      this.render();
      return true;
    }

    if (props.event.key === 'ArrowUp') {
      props.event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.render();
      return true;
    }

    if (props.event.key === 'Enter' || props.event.key === 'Tab') {
      props.event.preventDefault();
      this.selectItem();
      return true;
    }

    if (props.event.key === 'Escape') {
      props.event.preventDefault();
      this.destroy();
      return true;
    }

    return false;
  }

  private selectItem() {
    const items = this.getFilteredItems();
    const item = items[this.selectedIndex];
    if (item && this.props) {
      item.command({ editor: this.props.editor, range: this.props.range });
    }
    this.destroy();
  }

  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }
}
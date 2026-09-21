import { useEditor } from '@tiptap/react';
import { useState, useEffect, useRef, useCallback } from 'react';

export function FloatingToolbar({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<number>();

  const updatePosition = useCallback(() => {
    if (!editor || !editor.view) return;

    const { state } = editor;
    const { selection } = state;
    const { from, to, empty } = selection;

    if (empty) {
      setVisible(false);
      return;
    }

    const coords = editor.view.coordsAtPos(from);
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const toolbarRect = toolbar.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    let left = coords.left - toolbarRect.width / 2;
    left = Math.max(16, Math.min(left, viewportWidth - toolbarRect.width - 16));

    let top = coords.top - toolbarRect.height - 12;

    if (top < 16) {
      top = coords.bottom + 12;
    }

    setPosition({ top, left });
    setVisible(true);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      updatePosition();
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('blur', () => {
      hideTimeoutRef.current = window.setTimeout(() => setVisible(false), 150);
    });
    editor.on('focus', updatePosition);

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('blur', () => {});
      editor.off('focus', updatePosition);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [editor, updatePosition]);

  const handleFormat = (format: string) => {
    if (!editor) return;
    editor.chain().focus()[format]().run();
  };

  const handleLink = () => {
    if (!editor) return;
    const { state } = editor;
    const { selection } = state;
    const { from, to, empty } = selection;

    if (empty) return;

    const url = prompt('Enter URL:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const hasLink = editor?.isActive('link');
  const linkAttrs = editor?.getAttributes('link');
  const currentUrl = linkAttrs?.href;

  const handleHeading = (level: 2 | 3) => {
    if (!editor) return;
    editor.chain().focus().toggleHeading({ level }).run();
  };

  const handleQuote = () => {
    if (!editor) return;
    editor.chain().focus().toggleBlockquote().run();
  };

  const isActive = (mark: string) => editor?.isActive(mark) ?? false;
  const isHeadingActive = (level: number) => editor?.isActive('heading', { level }) ?? false;
  const isQuoteActive = editor?.isActive('blockquote') ?? false;

  if (!visible || !editor) return null;

  const marks = editor.state.selection.$from.marks();
  const canFormat = marks.some((m) => ['bold', 'italic', 'link'].includes(m.type.name)) || editor.can().setBold() || editor.can().setItalic();
  const canHeading = editor.can().toggleHeading({ level: 2 }) || editor.can().toggleHeading({ level: 3 });
  const canQuote = editor.can().toggleBlockquote();

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar"
      style={{ top: position.top, left: position.left }}
      role="toolbar"
      aria-label="Text formatting"
    >
      <button type="button" className={`toolbar-btn ${isActive('bold') ? 'active' : ''}`} onClick={() => handleFormat('toggleBold')} aria-pressed={isActive('bold')} aria-label="Bold (⌘B)">
        <strong>B</strong>
      </button>
      <button type="button" className={`toolbar-btn ${isActive('italic') ? 'active' : ''}`} onClick={() => handleFormat('toggleItalic')} aria-pressed={isActive('italic')} aria-label="Italic (⌘I)">
        <em>I</em>
      </button>
      <button type="button" className={`toolbar-btn ${hasLink ? 'active' : ''}`} onClick={handleLink} aria-pressed={hasLink} aria-label="Link (⌘K)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>

      {canHeading && (
        <>
          <button type="button" className={`toolbar-btn ${isHeadingActive(2) ? 'active' : ''}`} onClick={() => handleHeading(2)} aria-pressed={isHeadingActive(2)} aria-label="Heading">
            H
          </button>
          <button type="button" className={`toolbar-btn ${isHeadingActive(3) ? 'active' : ''}`} onClick={() => handleHeading(3)} aria-pressed={isHeadingActive(3)} aria-label="Subheading">
            h
          </button>
        </>
      )}

      {canQuote && (
        <button type="button" className={`toolbar-btn ${isQuoteActive ? 'active' : ''}`} onClick={handleQuote} aria-pressed={isQuoteActive} aria-label="Quote">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"></path></svg>
        </button>
      )}
    </div>
  );
}
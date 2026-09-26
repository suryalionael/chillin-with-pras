import { useEditor } from '@tiptap/react';
import { useState, useEffect, useRef, useCallback } from 'react';

export function FloatingToolbar({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const updatePosition = useCallback(() => {
    if (!editor || !editor.view) return;

    const { state } = editor;
    const { selection } = state;
    const { from, empty } = selection;

    if (empty) {
      setVisible(false);
      return;
    }

    const coords = editor.view.coordsAtPos(from);
    const toolbar = toolbarRef.current;
    const viewportWidth = window.innerWidth;

    // Centered on the selection when measured; otherwise keep it near the
    // caret so the first selection still shows a toolbar.
    const half = toolbar ? toolbar.getBoundingClientRect().width / 2 : 20;
    let left = coords.left - half;
    left = Math.max(16, Math.min(left, viewportWidth - (toolbar ? toolbar.getBoundingClientRect().width + 16 : 56)));

    let top = coords.top - 12;

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

    const handleBlur = () => {
      hideTimeoutRef.current = setTimeout(() => setVisible(false), 150);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('blur', handleBlur);
    editor.on('focus', updatePosition);

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('blur', handleBlur);
      editor.off('focus', updatePosition);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [editor, updatePosition]);

  const handleFormat = (format: 'toggleBold' | 'toggleItalic') => {
    if (!editor) return;
    if (format === 'toggleBold') editor.chain().focus().toggleBold().run();
    else editor.chain().focus().toggleItalic().run();
  };

  const handleLink = () => {
    if (!editor) return;
    const { state } = editor;
    const { selection } = state;
    const { empty } = selection;

    if (empty) return;

    const url = prompt('Enter URL:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const hasLink = editor?.isActive('link');

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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
      </button>

      {canHeading && (
        <>
          <button type="button" className={`toolbar-btn ${isHeadingActive(2) ? 'active' : ''}`} onClick={() => handleHeading(2)} aria-pressed={isHeadingActive(2)} aria-label="Heading">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 12l3-2v10"/></svg>
          </button>
          <button type="button" className={`toolbar-btn ${isHeadingActive(3) ? 'active' : ''}`} onClick={() => handleHeading(3)} aria-pressed={isHeadingActive(3)} aria-label="Subheading">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></svg>
          </button>
        </>
      )}

      {canQuote && (
        <button type="button" className={`toolbar-btn ${isQuoteActive ? 'active' : ''}`} onClick={handleQuote} aria-pressed={isQuoteActive} aria-label="Quote">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V21c0 3 4 3 4 3z"></path></svg>
        </button>
      )}
    </div>
  );
}
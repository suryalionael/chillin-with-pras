import { Extension } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Suggestion from '@tiptap/suggestion';
import type { StoryDocument } from '../../lib/cms/schema.ts';
import { FloatingToolbar } from './FloatingToolbar.tsx';
import { SlashMenu, SLASH_ITEMS, type SlashMenuProps } from './SlashMenu.tsx';
import { useAutosave } from './useAutosave.ts';
import { useLocalBackup } from './useLocalBackup.ts';
import { Image } from './ImageExtension.ts';
import { Embed } from './EmbedExtension.ts';
import { ImagePicker } from './ImagePicker.tsx';
import { useState, useEffect, useRef, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';

/** Shape of a JSON error/response body from the admin API. Cloudflare Workers'
 * Response.json() types as unknown, so every fetch call site needs this. */
interface ApiBody {
  story?: unknown;
  build?: { revision?: number | null; status?: string; requested?: boolean; error?: string | null };
  error?: { code?: string; message?: string; currentRev?: number; issues?: { message: string }[] };
}

interface StoryEditorProps {
  storyId: string;
  initialDoc: StoryDocument;
  initialRev: number;
  onSave: (doc: StoryDocument, baseRev: number) => Promise<{ draftRev: number; draftUpdatedAt: string } | null>;
  onTitleChange: (title: string) => void;
  onSubtitleChange: (subtitle: string) => void;
}

const BASE_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    bulletList: { keepMarks: true, keepAttributes: false },
    orderedList: { keepMarks: true, keepAttributes: false },
    link: false,
  }),
  Placeholder.configure({
    placeholder: ({ node }) => {
      if (node.type.name === 'heading') return node.attrs.level === 2 ? 'Heading' : 'Subheading';
      if (node.type.name === 'paragraph') return 'Start writing...';
      if (node.type.name === 'blockquote') return 'Quote';
      return '';
    },
    emptyEditorClass: 'is-editor-empty',
  }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { rel: 'noopener noreferrer' },
    validate: (href: string) => {
      if (!href || href.length > 2048) return false;
      if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\');
      try {
        const u = new URL(href);
        return ['http:', 'https:', 'mailto:'].includes(u.protocol);
      } catch {
        return false;
      }
    },
  }),
];


export function StoryEditor({ storyId, initialDoc, initialRev, onSave, onTitleChange, onSubtitleChange }: StoryEditorProps) {
  const [title, setTitle] = useState(initialDoc.title);
  const [subtitle, setSubtitle] = useState(initialDoc.subtitle);
  const [doc, setDoc] = useState<StoryDocument>(initialDoc);
  const [rev, setRev] = useState(initialRev);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'unsaved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showConflict, setShowConflict] = useState<{ currentRev: number } | null>(null);
  const [showInsertPlus, setShowInsertPlus] = useState(false);
  const [insertPlusPos, setInsertPlusPos] = useState({ top: 0, left: 0 });
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [pendingImageRange, setPendingImageRange] = useState<{ from: number; to: number } | null>(null);
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const insertPlusBlockRef = useRef<{ from: number; to: number } | null>(null);
  const pageMenuRef = useRef<SlashMenu | null>(null);
  const hoveredBlockRef = useRef<Element | null>(null);

  // @tiptap/suggestion v3 exports a ProseMirror plugin factory, not an
  // extension with .configure(). It must be wrapped in an Extension whose
  // options are built here (the render() hooks need component state setters).
  const extensions = useMemo(() => {
    const slashMenu = Extension.create({
      name: 'slash-menu',
      addProseMirrorPlugins() {
        return [
          Suggestion({
            char: '/',
            editor: this.editor,
            allow: ({ state, range }) => {
              const $from = state.doc.resolve(range.from);
              const parent = $from.parent;
              // the trigger must sit at the very start of its paragraph (no
              // leading text), so "/" opens the menu at the start of a block
              const textBefore = parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
              return parent.type.name === 'paragraph' && textBefore.replace(/\//g, '').trim() === '';
            },
            items: () => SLASH_ITEMS,
            render: () => {
              let component: SlashMenu | null = null;
              return {
                onStart: (props) => {
                  component = new SlashMenu(props);
                  component.setOnImagePickerRequest((range) => {
                    setPendingImageRange(range);
                    setImagePickerOpen(true);
                  });
                },
                onUpdate: (props) => { component?.update(props); },
                onKeyDown: (props) => { return component?.onKeyDown(props) ?? false; },
                onExit: () => { component?.destroy(); component = null; },
              };
            },
          }),
        ];
      },
    });
    return [...BASE_EXTENSIONS, slashMenu];
  }, []);

  const editor = useEditor({
    extensions: [...extensions, Image, Embed],
    content: initialDoc.body,
    autofocus: true,
    editorProps: {
      attributes: {
        class: 'prose-editor',
        spellCheck: 'true',
        autoCapitalize: 'sentences',
        autoCorrect: 'on',
      },
    },
    onUpdate: ({ editor }) => {
      // getJSON() returns tiptap's generic JSON shape; the server re-validates
      // every document against the strict schema before it is ever stored.
      onEditorUpdate(editor.getJSON() as StoryDocument['body']);
    },
  });

  // Tiptap autofocus issues an initial transaction during editor creation, which
  // fires onUpdate before React has mounted and triggers the "state update on an
  // unmounted component" warning. Skip updates until after mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
  }, []);

  const closeInsertMenu = useCallback(() => {
    pageMenuRef.current?.destroy();
    pageMenuRef.current = null;
  }, []);

  const openInsertMenu = useCallback((range: { from: number; to: number }) => {
    if (!editor?.view) return;
    closeInsertMenu();
    setShowInsertPlus(false);
    hoveredBlockRef.current = null;

    // A block that already has text must not be converted/merged into
    // whatever the user picks next — insert a fresh empty paragraph right
    // after it and open the menu there instead. An already-empty block (the
    // common case: the last line of the document) can be used directly.
    // Read the live document here rather than trusting anything cached at
    // hover time: the user typically clicks into a block and starts typing
    // without ever moving the mouse again, so a value captured on mouse-enter
    // would be stale by the time they open this menu.
    const $pos = editor.state.doc.resolve(range.from);
    const blockIsEmpty = $pos.parent.content.size === 0;
    let menuPos = range.from;
    if (!blockIsEmpty) {
      const insertPos = $pos.after($pos.depth);
      editor.chain().focus().insertContentAt(insertPos, { type: 'paragraph' }).run();
      menuPos = insertPos + 1;
    }
    editor.chain().focus().setTextSelection(menuPos).run();
    const menuRange = { from: menuPos, to: menuPos };
    const props: SlashMenuProps = { editor, range: menuRange, query: '' };
    const menu = new SlashMenu(props);
    menu.setOnImagePickerRequest((r) => {
      setPendingImageRange(r);
      setImagePickerOpen(true);
    });
    menu.setOnDestroy(() => {
      if (pageMenuRef.current === menu) pageMenuRef.current = null;
      insertPlusBlockRef.current = null;
    });
    pageMenuRef.current = menu;
  }, [editor, closeInsertMenu]);

  const handleBodyMouseMove = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (!editor?.view || pageMenuRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('.editor-insert-plus')) return;
    const dom = editor.view.dom as HTMLElement;
    const domRect = dom.getBoundingClientRect();

    // The + button sits in the gutter to the left of the text, outside any
    // block element. A plain target.closest() hit-test hides the button the
    // instant the cursor crosses that gap — before it ever reaches the
    // button — because the gap isn't over a <p>/<h2>/etc either. Checking
    // "is the cursor's Y within a block's row" instead (regardless of exactly
    // what DOM node is under the pixel) survives that gap.
    const GUTTER = 60;
    if (e.clientX < domRect.left - GUTTER || e.clientX > domRect.right || e.clientY < domRect.top || e.clientY > domRect.bottom) {
      if (hoveredBlockRef.current) {
        hoveredBlockRef.current = null;
        setShowInsertPlus(false);
      }
      return;
    }

    let block: HTMLElement | null = null;
    for (const el of dom.querySelectorAll('p, h2, h3, blockquote, li')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        block = el as HTMLElement;
        break;
      }
    }
    if (!block) {
      if (hoveredBlockRef.current) {
        hoveredBlockRef.current = null;
        setShowInsertPlus(false);
      }
      return;
    }
    if (hoveredBlockRef.current === block) return;
    hoveredBlockRef.current = block;
    try {
      const from = editor.view.posAtDOM(block, 0);
      const coords = editor.view.coordsAtPos(from);
      insertPlusBlockRef.current = { from, to: from };
      setInsertPlusPos({ top: coords.top + (coords.bottom - coords.top) / 2 - 10, left: coords.left - 44 });
      setShowInsertPlus(true);
    } catch {
      setShowInsertPlus(false);
    }
  }, [editor]);

  const handleBodyMouseLeave = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to && (to as HTMLElement).closest?.('.editor-insert-plus')) return;
    hoveredBlockRef.current = null;
    setShowInsertPlus(false);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const onDocKeydown = (e: KeyboardEvent) => {
      const menu = pageMenuRef.current;
      if (!menu || !menu.el || !insertPlusBlockRef.current) return;
      const prev = insertPlusBlockRef.current;
      const handled = menu.onKeyDown({ view: editor.view, event: e, range: prev });
      if (handled) {
        e.preventDefault();
        if (!pageMenuRef.current?.el) {
          pageMenuRef.current = null;
          insertPlusBlockRef.current = null;
          setShowInsertPlus(false);
        }
      }
    };
    document.addEventListener('keydown', onDocKeydown, true);
    const onDocDown = (e: MouseEvent) => {
      if (!pageMenuRef.current) return;
      const el = pageMenuRef.current.el;
      if (el && el.contains(e.target as Node)) return;
      closeInsertMenu();
      insertPlusBlockRef.current = null;
      setShowInsertPlus(false);
    };
    document.addEventListener('mousedown', onDocDown, true);
    return () => {
      document.removeEventListener('keydown', onDocKeydown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      closeInsertMenu();
    };
  }, [editor, closeInsertMenu]);

  const { saveWithDebounce, cancelSave } = useAutosave({
    storyId,
    getDoc: () => ({ ...doc, title, subtitle }),
    getRev: () => rev,
    onSave: async (d, r) => {
      const result = await onSave(d, r);
      if (result) {
        setRev(result.draftRev);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2000);
      }
      return result;
    },
    onConflict: (currentRev) => {
      setShowConflict({ currentRev });
      setStatus('error');
    },
    onError: (msg) => {
      setError(msg);
      setStatus('error');
    },
  });

  // The actual save trigger for everything the author writes: title/subtitle
  // changes call this too (handleTitleInput/handleSubtitleInput below), but
  // this is the only place body edits — every paragraph, image, heading —
  // ever get scheduled to save. Without it the draft only persists whatever
  // was true the last time the title or subtitle happened to change, which
  // for most of a writing session is nothing.
  const onEditorUpdate = useCallback((newDoc: StoryDocument['body']) => {
    if (!mountedRef.current) return;
    setDoc((prev) => ({ ...prev, body: newDoc }));
    setStatus('unsaved');
    void saveWithDebounce();
  }, [saveWithDebounce]);

  useLocalBackup({
    storyId,
    getDoc: () => doc,
    getTitle: () => title,
    getSubtitle: () => subtitle,
    onRestore: (backup) => {
      if (backup) {
        setDoc(backup.doc);
        setTitle(backup.title);
        setSubtitle(backup.subtitle);
        editor?.commands.setContent(backup.doc.body);
      }
    },
  });

  const handleTitleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setTitle(value);
      onTitleChange(value);
      setStatus('unsaved');
      void saveWithDebounce();
    },
    [onTitleChange, saveWithDebounce],
  );

  const handleSubtitleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSubtitle(value);
      onSubtitleChange(value);
      setStatus('unsaved');
      void saveWithDebounce();
    },
    [onSubtitleChange, saveWithDebounce],
  );

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (status === 'unsaved' || status === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status]);

  const handleSave = useCallback(async () => {
    if (status !== 'unsaved' && status !== 'error') return;
    setStatus('saving');
    await saveWithDebounce(true);
  }, [status, saveWithDebounce]);

  const handlePublish = useCallback(async () => {
    if (status === 'saving') return;
    cancelSave();
    setStatus('saving');
    setError(null);
    setPublishNote(null);

    // Flush the working draft first so the publish posts exactly what is on screen.
    let baseRev = rev;
    try {
      const saved = await onSave({ ...doc, title, subtitle }, rev);
      if (saved) {
        setRev(saved.draftRev);
        baseRev = saved.draftRev;
      }
    } catch (e) {
      if (e instanceof Response && e.status === 409) {
        const data = (await e.json()) as ApiBody;
        setShowConflict({ currentRev: data.error?.currentRev ?? rev });
      } else {
        setError(e instanceof Error ? e.message : 'Could not save before publishing.');
      }
      setStatus('error');
      return;
    }

    try {
      const res = await fetch(`/api/admin/stories/${storyId}/publish/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRev }),
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as ApiBody;
      if (!res.ok) {
        if (res.status === 409 && data.error?.code === 'conflict') {
          setShowConflict({ currentRev: data.error.currentRev ?? rev });
        } else if (res.status === 422 && Array.isArray(data.error?.issues)) {
          setError(data.error.issues.map((i) => i.message).join(' '));
        } else {
          setError(data.error?.message || 'Publish failed');
        }
        setStatus('error');
        return;
      }
      setStatus('saved');
      setError(null);
      const build = data.build;
      if (build?.status === 'deployed') setPublishNote(null);
      else if (build?.status === 'failed') setPublishNote(`Published, but shipping it to the live site failed: ${build.error}. It will retry on the next publish.`);
      else if (build?.requested) setPublishNote(`Published (revision ${build.revision ?? '—'}). Deployment is not configured yet, so it has not gone live.`);
      else setPublishNote(null);
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
      setStatus('error');
    }
  }, [status, cancelSave, doc, title, subtitle, rev, onSave, storyId]);

  const handleConflictResolve = useCallback(async (useLocal: boolean) => {
    if (!showConflict) return;
    if (useLocal) {
      await saveWithDebounce(true);
    } else {
      const fresh = await onSave(doc, showConflict.currentRev);
      if (fresh) {
        setRev(fresh.draftRev);
        setStatus('saved');
      }
    }
    setShowConflict(null);
  }, [showConflict, doc, onSave, saveWithDebounce]);

  const handleImageSelect = useCallback((image: { id: string; filename: string }) => {
    if (!editor || !pendingImageRange) return;
    // Default alt to the filename stem so inserted images are publishable and
    // accessible right away; the author can still replace it later (caption and
    // alt remain editable fields on the image node).
    const alt = (image.filename || '').replace(/\.[a-z0-9]+$/i, '').trim() || image.id;
    editor.chain().focus().deleteRange(pendingImageRange).setImage({
      imageId: image.id,
      alt,
      caption: '',
      decorative: false,
      size: 'wide',
    }).run();
    setPendingImageRange(null);
    setImagePickerOpen(false);
  }, [editor, pendingImageRange]);

  return (
    <div className="editor-shell" data-testid="editor-root">
      <header className="editor-header">
        <div className="editor-header__left">
          <a href="/admin/" className="editor-back">← Stories</a>
        </div>
        <div className="editor-header__center">
          <span className={`editor-status editor-status--${status}`}>
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved'}
            {status === 'unsaved' && 'Unsaved changes'}
            {status === 'error' && (error || 'Save failed')}
            {status === 'idle' && 'Draft in progress'}
          </span>
        </div>
        <div className="editor-header__right">
          <button className="admin-btn admin-btn--quiet" onClick={handleSave} disabled={status !== 'unsaved' && status !== 'error'}>Save</button>
          <a className="admin-btn admin-btn--quiet" href={`/admin/stories/${storyId}/preview/`}>Preview</a>
          <button className="admin-btn" onClick={handlePublish} disabled={status === 'saving'}>
            {status === 'saving' ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </header>

      {showConflict && (
        <div className="editor-conflict" role="alert">
          <p>This story was edited elsewhere (revision {showConflict.currentRev}).</p>
          <div className="editor-conflict__actions">
            <button className="admin-btn" onClick={() => handleConflictResolve(true)}>Keep my changes</button>
            <button className="admin-btn admin-btn--quiet" onClick={() => handleConflictResolve(false)}>Load server version</button>
          </div>
        </div>
      )}

      {publishNote && (
        <div className="editor-publish-note" role="status">
          {publishNote}
        </div>
      )}

      <main className="editor-main" onMouseMove={handleBodyMouseMove} onMouseLeave={handleBodyMouseLeave}>
        <div className="editor-writing-area">
          <textarea
            id="editor-title"
            className="editor-title"
            placeholder="Title"
            value={title}
            onChange={handleTitleInput}
            rows={1}
            aria-label="Story title"
          />
          <textarea
            id="editor-subtitle"
            className="editor-subtitle"
            placeholder="Add a subtitle…"
            value={subtitle}
            onChange={handleSubtitleInput}
            rows={1}
            aria-label="Story subtitle"
          />
          <div className="editor-body" data-testid="editor-body">
            <EditorContent editor={editor} />
          </div>
        </div>

        {showInsertPlus && insertPlusBlockRef.current && (
          <button
            type="button"
            className="editor-insert-plus"
            style={{ top: insertPlusPos.top, left: insertPlusPos.left }}
            onClick={() => { const r = insertPlusBlockRef.current; if (r) openInsertMenu(r); }}
            aria-label="Add content"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        )}

        <FloatingToolbar editor={editor} />

        <ImagePicker
          isOpen={imagePickerOpen}
          onClose={() => setImagePickerOpen(false)}
          onSelect={handleImageSelect}
        />
      </main>
    </div>
  );
}
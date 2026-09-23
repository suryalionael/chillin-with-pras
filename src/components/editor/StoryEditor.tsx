import { Extension } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { v4 as uuidv4 } from 'crypto';
import type { StoryDocument } from '../../lib/cms/schema.ts';
import { FloatingToolbar } from './FloatingToolbar.tsx';
import { SlashMenu } from './SlashMenu.tsx';
import { useAutosave } from './useAutosave.ts';
import { useLocalBackup } from './useLocalBackup.ts';
import { Image } from './ImageExtension.ts';
import { Embed } from './EmbedExtension.ts';
import { ImagePicker } from './ImagePicker.tsx';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

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
    blockquote: { keepMarks: true, keepAttributes: false },
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

const SLASH_ITEMS = [
  { title: 'Paragraph', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
  { title: 'Heading', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run() },
  { title: 'Subheading', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run() },
  { title: 'Quote', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setBlockquote().run() },
  { title: 'Bulleted list', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: 'Numbered list', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: 'Divider', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
  { title: 'Image', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).run() },
  { title: 'Embed', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setEmbed({ url: '' }).run() },
];

export function StoryEditor({ storyId, initialDoc, initialRev, onSave, onTitleChange, onSubtitleChange }: StoryEditorProps) {
  const [title, setTitle] = useState(initialDoc.title);
  const [subtitle, setSubtitle] = useState(initialDoc.subtitle);
  const [doc, setDoc] = useState<StoryDocument>(initialDoc);
  const [rev, setRev] = useState(initialRev);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'unsaved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showConflict, setShowConflict] = useState<{ currentRev: number } | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [pendingImageRange, setPendingImageRange] = useState<{ from: number; to: number } | null>(null);
  const [publishNote, setPublishNote] = useState<string | null>(null);

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
              const nodeType = $from.parent.type;
              return nodeType.name === 'paragraph' && $from.parent.textContent.length === 0 && $from.parentOffset === 0;
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
      const newDoc = editor.getJSON();
      setDoc((prev) => ({ ...prev, body: newDoc }));
    },
  });

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
      saveWithDebounce();
    },
    [onTitleChange, saveWithDebounce],
  );

  const handleSubtitleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSubtitle(value);
      onSubtitleChange(value);
      setStatus('unsaved');
      saveWithDebounce();
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
        const data = await e.json();
        setShowConflict({ currentRev: data.error.currentRev });
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.error?.code === 'conflict') {
          setShowConflict({ currentRev: data.error.currentRev });
        } else if (res.status === 422 && Array.isArray(data.error?.issues)) {
          setError(data.error.issues.map((i: { message: string }) => i.message).join(' '));
        } else {
          setError(data.error?.message || 'Publish failed');
        }
        setStatus('error');
        return;
      }
      setStatus('saved');
      setError(null);
      const build = (data as { build?: { triggered?: boolean; revision?: number | null; status?: string; error?: string | null } } | null)?.build;
      if (build && build.status && build.status !== 'deployed') {
        if (build.error) setPublishNote(`Published. Deployment not started: ${build.error}`);
        else if (build.status === 'deploy_requested') setPublishNote(`Published. Deployment requested (revision ${build.revision ?? '—'}).`);
        else setPublishNote(`Published. Deployment ${build.status}.`);
      } else {
        setPublishNote(null);
      }
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
    editor.chain().focus().deleteRange(pendingImageRange).setImage({
      imageId: image.id,
      alt: '',
      caption: '',
      decorative: false,
      size: 'wide',
    }).run();
    setPendingImageRange(null);
    setImagePickerOpen(false);
  }, [editor, pendingImageRange]);

  const handleImageUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/admin/images/', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Upload failed');
      }
      const data = await res.json();
      return data.image;
    } catch (e) {
      console.error('Image upload failed', e);
      return null;
    }
  }, []);

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
            {status === 'idle' && 'Ready'}
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

      <main className="editor-main">
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

        <FloatingToolbar editor={editor} />

        <ImagePicker
          isOpen={imagePickerOpen}
          onClose={() => setImagePickerOpen(false)}
          onSelect={handleImageSelect}
          onUpload={handleImageUpload}
        />
      </main>
    </div>
  );
}
import { StoryEditor } from './StoryEditor.tsx';
import type { StoryDocument } from '../../../lib/cms/schema.ts';
import { useState, useCallback, useEffect } from 'react';

interface EditorWrapperProps {
  storyId: string;
  initialDoc: string;
  initialRev: number;
}

type SaveOutcome = { draftRev: number; draftUpdatedAt: string };

export function EditorWrapper({ storyId, initialDoc, initialRev }: EditorWrapperProps) {
  const [doc, setDoc] = useState<StoryDocument>(JSON.parse(initialDoc));
  const [rev, setRev] = useState(initialRev);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');

  useEffect(() => {
    const parsed = JSON.parse(initialDoc);
    setDoc(parsed);
    setTitle(parsed.title);
    setSubtitle(parsed.subtitle);
  }, [initialDoc]);

  const handleSave = useCallback(
    async (d: StoryDocument, baseRev: number): Promise<SaveOutcome | null> => {
      const res = await fetch(`/api/admin/stories/${storyId}/draft/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRev, document: d }),
        credentials: 'same-origin',
      });
      if (!res.ok) throw res;
      const data = await res.json();
      return { draftRev: data.draftRev, draftUpdatedAt: data.draftUpdatedAt };
    },
    [storyId],
  );

  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    setDoc(prev => ({ ...prev, title: newTitle }));
  }, []);

  const handleSubtitleChange = useCallback((newSubtitle: string) => {
    setSubtitle(newSubtitle);
    setDoc(prev => ({ ...prev, subtitle: newSubtitle }));
  }, []);

  return (
    <StoryEditor
      storyId={storyId}
      initialDoc={doc}
      initialRev={rev}
      onSave={handleSave}
      onTitleChange={handleTitleChange}
      onSubtitleChange={handleSubtitleChange}
    />
  );
}
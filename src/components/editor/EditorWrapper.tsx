import { StoryEditor } from './StoryEditor.tsx';
import type { StoryDocument } from '../../lib/cms/schema.ts';
import { useState, useCallback, useEffect } from 'react';

interface EditorWrapperProps {
  storyId: string;
  initialDoc: string;
  initialRev: number;
}

type SaveOutcome = { draftRev: number; draftUpdatedAt: string };

export function EditorWrapper({ storyId, initialDoc, initialRev }: EditorWrapperProps) {
  const [doc, setDoc] = useState<StoryDocument>(JSON.parse(initialDoc));

  useEffect(() => {
    setDoc(JSON.parse(initialDoc));
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
      const data = (await res.json()) as SaveOutcome;
      return { draftRev: data.draftRev, draftUpdatedAt: data.draftUpdatedAt };
    },
    [storyId],
  );

  const handleTitleChange = useCallback((newTitle: string) => {
    setDoc((prev: StoryDocument) => ({ ...prev, title: newTitle }));
  }, []);

  const handleSubtitleChange = useCallback((newSubtitle: string) => {
    setDoc((prev: StoryDocument) => ({ ...prev, subtitle: newSubtitle }));
  }, []);

  return (
    <StoryEditor
      storyId={storyId}
      initialDoc={doc}
      initialRev={initialRev}
      onSave={handleSave}
      onTitleChange={handleTitleChange}
      onSubtitleChange={handleSubtitleChange}
    />
  );
}
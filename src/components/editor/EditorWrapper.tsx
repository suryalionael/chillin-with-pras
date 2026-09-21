import { StoryEditor } from './StoryEditor.tsx';
import { saveDraft } from '../../../lib/cms/db.ts';
import { getEnv } from '../../../lib/cms/runtime.ts';
import { type StoryDocument } from '../../../lib/cms/schema.ts';
import { useState, useCallback, useEffect } from 'react';

interface EditorWrapperProps {
  'story-id': string;
  'initial-doc': string;
  'initial-rev': number;
}

export function EditorWrapper({ 'story-id': storyId, 'initial-doc': initialDoc, 'initial-rev': initialRev }: EditorWrapperProps) {
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

  const handleSave = useCallback(async (d: StoryDocument, baseRev: number) => {
    const env = await getEnv();
    const result = await saveDraft(
      env.DB as any,
      storyId,
      { baseRev, document: d },
      { isSlugReserved: () => false }
    );
    if (result.ok) {
      return { draftRev: result.draftRev, draftUpdatedAt: result.draftUpdatedAt };
    }
    if (result.reason === 'conflict') {
      throw new Response(JSON.stringify({ error: { code: 'conflict', currentRev: result.currentRev } }), { status: 409 });
    }
    throw new Error(result.reason);
  }, [storyId]);

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
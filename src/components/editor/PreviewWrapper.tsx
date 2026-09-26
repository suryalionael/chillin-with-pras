import { PreviewRenderer } from './PreviewRenderer.tsx';
import { type StoryDocument } from '../../lib/cms/schema.ts';
import { useState, useEffect } from 'react';

interface PreviewWrapperProps {
  initialDoc: string;
  storyId: string;
}

export function PreviewWrapper({ initialDoc }: PreviewWrapperProps) {
  const [doc, setDoc] = useState<StoryDocument>(JSON.parse(initialDoc));

  useEffect(() => {
    setDoc(JSON.parse(initialDoc));
  }, [initialDoc]);

  return (
    <PreviewRenderer
      doc={doc}
      title={doc.title}
      subtitle={doc.subtitle}
      dateline={doc.dateline}
    />
  );
}
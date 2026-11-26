import { PreviewRenderer, type ImageDims } from './PreviewRenderer.tsx';
import { type StoryDocument } from '../../lib/cms/schema.ts';
import { useState, useEffect, useMemo } from 'react';

interface PreviewWrapperProps {
  initialDoc: string;
  storyId: string;
  /** JSON of each image's stored width/height, keyed by image id. */
  imageDims?: string;
}

export function PreviewWrapper({ initialDoc, imageDims }: PreviewWrapperProps) {
  const dims = useMemo<ImageDims>(() => (imageDims ? JSON.parse(imageDims) : {}), [imageDims]);
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
      imageDims={dims}
    />
  );
}
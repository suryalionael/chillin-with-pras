import { useCallback, useRef, useEffect } from 'react';
import type { StoryDocument } from '../../lib/cms/schema.ts';

interface UseAutosaveOptions {
  storyId: string;
  getDoc: () => StoryDocument;
  getRev: () => number;
  onSave: (doc: StoryDocument, baseRev: number) => Promise<{ draftRev: number; draftUpdatedAt: string } | null>;
  onConflict: (currentRev: number) => void;
  onError: (message: string) => void;
  debounceMs?: number;
}

export function useAutosave({
  storyId,
  getDoc,
  getRev,
  onSave,
  onConflict,
  onError,
  debounceMs = 1500,
}: UseAutosaveOptions) {
  const timeoutRef = useRef<number>();
  const pendingRef = useRef(false);
  const lastSavedDocRef = useRef<string>('');
  const lastSavedRevRef = useRef<number>(getRev());

  // Keep the latest callbacks in refs so a debounced flush always reads fresh
  // state. The editor's title/subtitle live in state that updates asynchronously,
  // so a closure captured at schedule time would save stale values.
  const callbacksRef = useRef({ getDoc, getRev, onSave, onConflict, onError });
  callbacksRef.current = { getDoc, getRev, onSave, onConflict, onError };
  const storyIdRef = useRef(storyId);
  storyIdRef.current = storyId;

  const hasChanges = useCallback(() => {
    const current = JSON.stringify(callbacksRef.current.getDoc());
    return current !== lastSavedDocRef.current;
  }, []);

  const saveNow = useCallback(async (immediate = false) => {
    const { getDoc, getRev, onSave, onConflict, onError } = callbacksRef.current;
    if (!hasChanges() && !immediate) return null;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    if (pendingRef.current && !immediate) return null;

    const doc = getDoc();
    const baseRev = getRev();

    pendingRef.current = true;

    try {
      const result = await onSave(doc, baseRev);
      if (result) {
        lastSavedDocRef.current = JSON.stringify(doc);
        lastSavedRevRef.current = result.draftRev;
      }
      pendingRef.current = false;
      return result;
    } catch (err) {
      pendingRef.current = false;
      if (err instanceof Response && err.status === 409) {
        const data = await err.json();
        onConflict(data.error.currentRev);
      } else {
        onError(err instanceof Error ? err.message : 'Save failed');
      }
      return null;
    }
  }, [hasChanges]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      void saveNow();
    }, debounceMs);
  }, [saveNow, debounceMs]);

  const cancelSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  return { saveWithDebounce: triggerSave, cancelSave };
}
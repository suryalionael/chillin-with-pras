import { useCallback, useRef, useEffect } from 'react';
import type { StoryDocument } from '../../lib/cms/schema.ts';

type SaveResult = { draftRev: number; draftUpdatedAt: string } | null;

export interface SaveErrorBody {
  error?: { message?: string; issues?: { path: string; message: string }[] };
}

/**
 * Turns a failed save response into the message actually shown to the
 * writer. Pulled out as a pure function (no fetch, no React) specifically so
 * it can be unit-tested without a browser/DOM harness — this project has no
 * React testing setup, and the bug this fixes (every non-409 save failure
 * collapsing to the single string "Save failed", discarding the server's own
 * explanation) is a pure data transformation, not something that needs one.
 */
export function describeSaveError(status: number, body: SaveErrorBody | null): string {
  const issues = body?.error?.issues;
  if (issues && issues.length > 0) return issues.map((i) => i.message).join(' ');
  if (body?.error?.message) return body.error.message;
  return `Save failed (${status}).`;
}

interface UseAutosaveOptions {
  storyId: string;
  getDoc: () => StoryDocument;
  getRev: () => number;
  onSave: (doc: StoryDocument, baseRev: number) => Promise<SaveResult>;
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  const saveNow = useCallback(async (immediate = false): Promise<SaveResult> => {
    const { getDoc, getRev, onSave, onConflict, onError } = callbacksRef.current;
    if (!hasChanges() && !immediate) return null;
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
      if (err instanceof Response) {
        if (err.status === 409) {
          const data = (await err.json().catch(() => null)) as { error?: { currentRev?: number } } | null;
          onConflict(data?.error?.currentRev ?? getRev());
          return null;
        }
        // Read the actual reason instead of a generic "Save failed" — a 422
        // here almost always names exactly which block/attribute is invalid
        // (see schema.ts's publishIssues/parseStoryDocument), and silently
        // dropping that was the root cause of saves that looked unexplainably
        // stuck: the editor would accept content the server then rejected
        // (e.g. an http:// embed link, valid-looking in the editor's own
        // preview) with no way to tell what to fix.
        const data = (await err.json().catch(() => null)) as SaveErrorBody | null;
        onError(describeSaveError(err.status, data));
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

  /**
   * `immediate=false` (the default, e.g. on every keystroke): debounces and
   * resolves once that debounced save finishes.
   * `immediate=true` (Save button, conflict resolution): cancels any pending
   * debounce and flushes right away, bypassing the hasChanges() guard so a
   * forced save always reaches the server before the caller proceeds.
   */
  const saveWithDebounce = useCallback((immediate = false): Promise<SaveResult> => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    if (immediate) return saveNow(true);
    return new Promise((resolve) => {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined;
        void saveNow().then(resolve);
      }, debounceMs);
    });
  }, [saveNow, debounceMs]);

  const cancelSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  return { saveWithDebounce, cancelSave };
}

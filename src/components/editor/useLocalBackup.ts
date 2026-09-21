import { useEffect, useCallback } from 'react';
import type { StoryDocument } from '../../lib/cms/schema.ts';

interface BackupData {
  doc: StoryDocument;
  title: string;
  subtitle: string;
  timestamp: number;
  rev: number;
}

interface UseLocalBackupOptions {
  storyId: string;
  getDoc: () => StoryDocument;
  getTitle: () => string;
  getSubtitle: () => string;
  onRestore: (backup: BackupData | null) => void;
}

const STORAGE_KEY = 'chillin-editor-backup';

export function useLocalBackup({
  storyId,
  getDoc,
  getTitle,
  getSubtitle,
  onRestore,
}: UseLocalBackupOptions) {
  const backupKey = `${STORAGE_KEY}-${storyId}`;

  const saveBackup = useCallback(() => {
    try {
      const backup: BackupData = {
        doc: getDoc(),
        title: getTitle(),
        subtitle: getSubtitle(),
        timestamp: Date.now(),
        rev: 0,
      };
      localStorage.setItem(backupKey, JSON.stringify(backup));
    } catch {
      // Ignore quota errors
    }
  }, [backupKey, getDoc, getTitle, getSubtitle]);

  const loadBackup = useCallback((): BackupData | null => {
    try {
      const stored = localStorage.getItem(backupKey);
      if (!stored) return null;
      const backup = JSON.parse(stored) as BackupData;
      if (!backup.doc || !backup.title) return null;
      return backup;
    } catch {
      return null;
    }
  }, [backupKey]);

  const clearBackup = useCallback(() => {
    localStorage.removeItem(backupKey);
  }, [backupKey]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveBackup();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveBackup]);

  useEffect(() => {
    const backup = loadBackup();
    if (backup) {
      onRestore(backup);
    }
  }, [loadBackup, onRestore]);

  return { saveBackup, loadBackup, clearBackup };
}
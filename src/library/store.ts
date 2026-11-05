import { create } from 'zustand';
import { addPaper, deletePaper, listPapers, storageError, updatePapers } from './database';
import { validatePdf, type ImportReport, type LibrarySort, type Paper, type PaperPatch, type ReadingStatus } from './types';

interface LibraryState {
  papers: Paper[];
  portedCount: number | null;
  loading: boolean;
  loaded: boolean;
  error: string;
  query: string;
  status: ReadingStatus | 'all';
  year: string;
  sort: LibrarySort;
  importing: boolean;
  progress: { current: number; total: number };
  report: ImportReport | null;
  load: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  update: (ids: string[], patch: PaperPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const LIBRARY_IMPORT_EVENT = 'rw:library-import';

export const useLibraryStore = create<LibraryState>((set, get) => ({
  papers: [], portedCount: null, loading: false, loaded: false, error: '', query: '', status: 'all', year: 'all', sort: 'newest',
  importing: false, progress: { current: 0, total: 0 }, report: null,
  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: '' });
    try { set({ papers: await listPapers(), loaded: true }); }
    catch (error) { set({ error: storageError(error) }); }
    finally { set({ loading: false }); }
  },
  importFiles: async files => {
    if (get().importing || files.length === 0) return;
    set({ importing: true, report: null, progress: { current: 0, total: files.length } });
    const report: ImportReport = { added: 0, duplicates: [], failures: [] };
    try {
      for (const [index, file] of files.entries()) {
        try {
          // Validate size before reading the entire file into memory.
          validatePdf(file.name, file.size, new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer()));
          const bytes = await file.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
          const now = Date.now();
          const paper: Paper = {
            id: crypto.randomUUID(), fingerprint, title: file.name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
            authors: '', year: '', venue: '', tags: [], notes: '', status: 'unread',
            fileName: file.name, fileSize: file.size, createdAt: now, updatedAt: now,
          };
          const added = await addPaper(paper, new Blob([bytes], { type: 'application/pdf' }));
          if (added) report.added++; else report.duplicates.push(file.name);
        } catch (error) { report.failures.push({ name: file.name, message: storageError(error) }); }
        set({ progress: { current: index + 1, total: files.length } });
      }
      await get().load();
    } finally { set({ importing: false, report }); }
  },
  update: async (ids, patch) => {
    await updatePapers(ids, patch);
    set({ papers: await listPapers() });
  },
  remove: async id => {
    await deletePaper(id);
    set({ papers: await listPapers() });
  },
}));

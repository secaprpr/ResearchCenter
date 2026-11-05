import type { Paper, PaperPatch } from './types';

let connection: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('research-workbench-library', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('papers', { keyPath: 'id' }).createIndex('fingerprint', 'fingerprint', { unique: true });
        db.createObjectStore('files', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭其他旧版窗口后重试'));
    }).catch(error => { connection = undefined; throw error; });
  }
  return connection;
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('本地存储操作已取消'));
    transaction.onerror = () => { /* onabort reports the transaction error. */ };
  });
}

export async function listPapers(): Promise<Paper[]> {
  const db = await database();
  const transaction = db.transaction('papers', 'readonly');
  const done = complete(transaction);
  const request = transaction.objectStore('papers').getAll();
  await done;
  return request.result as Paper[];
}

export async function addPaper(paper: Paper, file: Blob): Promise<boolean> {
  const db = await database();
  const transaction = db.transaction(['papers', 'files'], 'readwrite');
  const done = complete(transaction);
  const papers = transaction.objectStore('papers');
  let added = false;
  const existing = papers.index('fingerprint').getKey(paper.fingerprint);
  existing.onsuccess = () => {
    if (existing.result !== undefined) return;
    papers.add(paper);
    transaction.objectStore('files').add({ id: paper.id, blob: file });
    added = true;
  };
  await done;
  return added;
}

export async function updatePapers(ids: string[], patch: PaperPatch): Promise<void> {
  const db = await database();
  const transaction = db.transaction('papers', 'readwrite');
  const done = complete(transaction);
  const store = transaction.objectStore('papers');
  for (const id of ids) {
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...patch, updatedAt: Date.now() });
    };
  }
  await done;
}

export async function deletePaper(id: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['papers', 'files'], 'readwrite');
  const done = complete(transaction);
  transaction.objectStore('papers').delete(id);
  transaction.objectStore('files').delete(id);
  await done;
}

export async function getPdf(id: string): Promise<Blob> {
  const db = await database();
  const transaction = db.transaction('files', 'readonly');
  const done = complete(transaction);
  const request = transaction.objectStore('files').get(id);
  await done;
  if (!request.result?.blob) throw new Error('找不到 PDF 文件，请重新导入');
  return request.result.blob as Blob;
}

export function storageError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '本地存储空间不足，请释放空间后重试';
  return error instanceof Error ? error.message : '本地存储暂时不可用，请重试';
}

// 留念照：壓縮後存在手機的 IndexedDB，不上傳、不放進備份連結
const DB = 'mrt-explorer-photos';
const STORE = 'photos';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function compress(file, maxSide = 1280, quality = 0.75) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export const savePhoto = (id, blob) => tx('readwrite', s => s.put(blob, id));
export const getPhoto = id => tx('readonly', s => s.get(id)).catch(() => null);
export const deletePhoto = id => tx('readwrite', s => s.delete(id)).catch(() => null);
export const clearPhotos = () => tx('readwrite', s => s.clear()).catch(() => null);

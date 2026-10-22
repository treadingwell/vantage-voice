import catalog from './catalog.json';

/**
 * Offline speech model storage. Models are opt-in downloads served from the app's own
 * /models/ folder (see scripts/fetch-models.mjs) and kept in CacheStorage so they work
 * in Airplane Mode. Used from both the main thread and the sherpa Web Worker.
 */

export const MODEL_CACHE_NAME = 'vantage-speech-models-v1';

export type ModelKind = 'tts' | 'stt';

export interface ModelVoice {
  sid: number;
  label: string;
}

export interface ModelEntry {
  id: string;
  kind: ModelKind;
  label: string;
  description: string;
  /** Attribution the model's license requires us to show */
  credit?: string;
  dir: string;
  approxMB: number;
  files: string[];
  voices?: ModelVoice[];
}

export interface RuntimeEntry {
  id: string;
  label: string;
  dir: string;
  approxMB: number;
  files: string[];
}

export const SHERPA_RUNTIME: RuntimeEntry = catalog.runtime;
export const SHERPA_MODELS: ModelEntry[] = catalog.models as ModelEntry[];

export type ModelProgressCallback = (loadedBytes: number, totalBytes: number) => void;

export function getModel(id: string): ModelEntry | undefined {
  return SHERPA_MODELS.find((m) => m.id === id);
}

/** Absolute URL of the app's models folder; pass it to the worker, whose own URL differs. */
export function defaultModelsBaseUrl(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
  return new URL(`${import.meta.env.BASE_URL}models/`, base).href;
}

export function modelFileUrl(baseUrl: string, dir: string, file: string): string {
  return new URL(`${dir}/${file}`, baseUrl).href;
}

function entryUrls(entry: ModelEntry | RuntimeEntry, baseUrl: string): string[] {
  return entry.files.map((f) => modelFileUrl(baseUrl, entry.dir, f));
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

async function allCached(urls: string[]): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  for (const url of urls) {
    if (!(await cache.match(url))) return false;
  }
  return true;
}

export async function isModelDownloaded(entry: ModelEntry, baseUrl = defaultModelsBaseUrl()): Promise<boolean> {
  return (await allCached(entryUrls(entry, baseUrl))) && (await allCached(entryUrls(SHERPA_RUNTIME, baseUrl)));
}

/**
 * Downloads every file of a model (plus the shared sherpa runtime if missing) into
 * CacheStorage, reporting combined byte progress.
 */
export async function downloadModel(
  entry: ModelEntry,
  onProgress?: ModelProgressCallback,
  baseUrl = defaultModelsBaseUrl()
): Promise<void> {
  const cache = await openCache();
  if (!cache) throw new Error('Offline storage is not available in this browser.');

  const urls = [...entryUrls(entry, baseUrl)];
  if (!(await allCached(entryUrls(SHERPA_RUNTIME, baseUrl)))) {
    urls.push(...entryUrls(SHERPA_RUNTIME, baseUrl));
  }

  // Content-Length isn't always exposed, so the estimate seeds the total until real sizes arrive
  let totalBytes = (entry.approxMB + SHERPA_RUNTIME.approxMB) * 1024 * 1024;
  let loadedBytes = 0;

  for (const url of urls) {
    if (await cache.match(url)) continue;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url.split('/').pop()}`);

    const chunks: Uint8Array[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedBytes += value.byteLength;
        totalBytes = Math.max(totalBytes, loadedBytes);
        onProgress?.(loadedBytes, totalBytes);
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      loadedBytes += buf.byteLength;
      onProgress?.(loadedBytes, totalBytes);
    }

    await cache.put(url, new Response(new Blob(chunks as BlobPart[])));
  }

  onProgress?.(totalBytes, totalBytes);
}

/** Removes a model's files; the shared runtime goes too once no sherpa model remains. */
export async function deleteModel(entry: ModelEntry, baseUrl = defaultModelsBaseUrl()): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  for (const url of entryUrls(entry, baseUrl)) {
    await cache.delete(url);
  }

  for (const other of SHERPA_MODELS) {
    if (other.id !== entry.id && (await allCached(entryUrls(other, baseUrl)))) return;
  }
  for (const url of entryUrls(SHERPA_RUNTIME, baseUrl)) {
    await cache.delete(url);
  }
}

/** Reads a cached model file, falling back to the network (e.g. during development). */
export async function readModelFile(url: string): Promise<Uint8Array> {
  const cache = await openCache();
  const cached = cache ? await cache.match(url) : undefined;
  const res = cached ?? (await fetch(url));
  if (!res.ok) throw new Error(`Missing model file ${url.split('/').pop()}`);
  return new Uint8Array(await res.arrayBuffer());
}

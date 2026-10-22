import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SHERPA_MODELS,
  SHERPA_RUNTIME,
  deleteModel,
  downloadModel,
  getModel,
  isModelDownloaded,
  modelFileUrl,
  readModelFile,
} from '../../src/speech/models/modelStore';

const BASE = 'https://app.test/models/';

/** Minimal in-memory CacheStorage: one cache, keyed by URL. */
function installFakeCaches(): Map<string, Response> {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, res: Response) => {
      store.set(url, res);
    },
    delete: async (url: string) => store.delete(url),
  };
  vi.stubGlobal('caches', { open: async () => cache });
  return store;
}

function installFakeFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'x-url': url } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const runtimeUrls = () => SHERPA_RUNTIME.files.map((f) => modelFileUrl(BASE, SHERPA_RUNTIME.dir, f));

describe('modelStore', () => {
  let store: Map<string, Response>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = installFakeCaches();
    fetchMock = installFakeFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('catalog has the three shipped models', () => {
    expect(getModel('kitten-nano')?.kind).toBe('tts');
    expect(getModel('supertonic-2')?.kind).toBe('tts');
    expect(getModel('kroko-en')?.kind).toBe('stt');
    expect(getModel('nope')).toBeUndefined();
  });

  it('downloads a model plus the shared runtime and reports progress to 100%', async () => {
    const model = getModel('kitten-nano')!;
    const progress: Array<[number, number]> = [];
    await downloadModel(model, (loaded, total) => progress.push([loaded, total]), BASE);

    expect(fetchMock).toHaveBeenCalledTimes(model.files.length + SHERPA_RUNTIME.files.length);
    expect(await isModelDownloaded(model, BASE)).toBe(true);
    const [lastLoaded, lastTotal] = progress[progress.length - 1];
    expect(lastLoaded).toBe(lastTotal);
  });

  it('skips files that are already cached', async () => {
    const kitten = getModel('kitten-nano')!;
    await downloadModel(kitten, undefined, BASE);
    fetchMock.mockClear();

    // The runtime is shared, so a second model only fetches its own files
    const kroko = getModel('kroko-en')!;
    await downloadModel(kroko, undefined, BASE);
    expect(fetchMock).toHaveBeenCalledTimes(kroko.files.length);
  });

  it('is not downloaded when a single file is missing', async () => {
    const model = getModel('kitten-nano')!;
    await downloadModel(model, undefined, BASE);
    store.delete(modelFileUrl(BASE, model.dir, model.files[0]));
    expect(await isModelDownloaded(model, BASE)).toBe(false);
  });

  it('keeps the runtime while another model still needs it, then removes it with the last one', async () => {
    const kitten = getModel('kitten-nano')!;
    const kroko = getModel('kroko-en')!;
    await downloadModel(kitten, undefined, BASE);
    await downloadModel(kroko, undefined, BASE);

    await deleteModel(kitten, BASE);
    expect(await isModelDownloaded(kitten, BASE)).toBe(false);
    expect(await isModelDownloaded(kroko, BASE)).toBe(true);
    expect(runtimeUrls().every((u) => store.has(u))).toBe(true);

    await deleteModel(kroko, BASE);
    expect(runtimeUrls().some((u) => store.has(u))).toBe(false);
    expect(store.size).toBe(0);
  });

  it('fails a download with the file name when the server returns an error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    const model = getModel('kitten-nano')!;
    await expect(downloadModel(model, undefined, BASE)).rejects.toThrow(`Download failed (404) for ${model.files[0].split('/').pop()}`);
  });

  it('reads cached files without touching the network', async () => {
    const model = getModel('kitten-nano')!;
    await downloadModel(model, undefined, BASE);
    fetchMock.mockClear();

    // Byte contents aren't checked: jsdom's Blob doesn't round-trip through Node's Response
    const bytes = await readModelFile(modelFileUrl(BASE, model.dir, model.files[0]));
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('every catalog model has files and a positive size', () => {
    for (const m of SHERPA_MODELS) {
      expect(m.files.length).toBeGreaterThan(0);
      expect(m.approxMB).toBeGreaterThan(0);
    }
  });
});

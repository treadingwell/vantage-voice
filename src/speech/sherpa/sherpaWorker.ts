/// <reference lib="webworker" />
/**
 * Hosts the sherpa-onnx WASM runtime off the main thread: neural TTS (Kitten, Supertonic)
 * and streaming speech recognition (Zipformer). The 15 MB WASM compiles synchronously,
 * which Chrome only allows inside a worker.
 */
import createModule from '../../vendor/sherpa/sherpa-glue.js';
import { createOfflineTts } from '../../vendor/sherpa/sherpa-tts.js';
import { createOnlineRecognizer } from '../../vendor/sherpa/sherpa-asr.js';
import type {
  OfflineTts,
  OnlineRecognizer,
  OnlineStream,
  SherpaModule,
} from '../../vendor/sherpa/sherpa';
import { getModel, modelFileUrl, readModelFile, SHERPA_RUNTIME, ModelEntry } from '../models/modelStore';
import type { SherpaRequest, SherpaWorkerMessage } from './sherpaProtocol';

declare const self: DedicatedWorkerGlobalScope;

const ASR_SAMPLE_RATE = 16000;
// Leading silence lets the recognizer settle so it doesn't drop the first word
const ASR_LEADING_SILENCE_SECONDS = 0.3;

let modulePromise: Promise<SherpaModule> | null = null;

let tts: OfflineTts | null = null;
let ttsModel: ModelEntry | null = null;

let recognizer: OnlineRecognizer | null = null;
let asrStream: OnlineStream | null = null;
let asrModelId: string | null = null;
let lastPartial = '';
// A stream can't change sample rate once it has resampled, so silence uses the mic's rate
let micSampleRate = ASR_SAMPLE_RATE;

// Per-model generation settings
const TTS_GENERATION_DEFAULTS: Record<string, Record<string, unknown>> = {
  // 4 flow steps: chosen by ear over 3 (slips more words) and 5 (slower on phones)
  'supertonic-2': { numSteps: 4, extra: { lang: 'en' } },
};

function post(msg: SherpaWorkerMessage, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function getModule(baseUrl: string): Promise<SherpaModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasmUrl = modelFileUrl(baseUrl, SHERPA_RUNTIME.dir, SHERPA_RUNTIME.files[0]);
      const wasmBinary = await readModelFile(wasmUrl);
      const mod = { wasmBinary, print: () => {}, printErr: (m: string) => console.warn('[sherpa]', m) };
      const ret = createModule(mod);
      if (ret && typeof (ret as Promise<unknown>).then === 'function') await ret;
      return mod as unknown as SherpaModule;
    })();
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}

/**
 * Copies a model's files into the in-memory filesystem, runs `create`, then deletes the
 * .onnx copies: the runtime has read those into its own memory by then, so keeping them
 * would double the footprint (matters on iOS). Other files stay, because some are read
 * while speaking (Kitten's espeak-ng pronunciation data).
 */
async function withModelFiles<T>(
  mod: SherpaModule,
  model: ModelEntry,
  baseUrl: string,
  create: (dir: string) => T
): Promise<T> {
  const dir = `/models/${model.dir}`;
  const written: string[] = [];
  try {
    for (const file of model.files) {
      const path = `${dir}/${file}`;
      // Kept support files may still be there from an earlier load
      if (!file.endsWith('.onnx') && fileExists(mod, path)) continue;
      const data = await readModelFile(modelFileUrl(baseUrl, model.dir, file));
      mod.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      mod.FS.writeFile(path, data);
      if (file.endsWith('.onnx')) written.push(path);
    }
    return create(dir);
  } finally {
    for (const path of written) {
      try {
        mod.FS.unlink(path);
      } catch {
        // ignore
      }
    }
  }
}

function fileExists(mod: SherpaModule, path: string): boolean {
  try {
    mod.FS.stat(path);
    return true;
  } catch {
    return false;
  }
}

function ttsModelConfig(model: ModelEntry, dir: string): Record<string, unknown> {
  switch (model.id) {
    case 'kitten-nano':
      return {
        kitten: {
          model: `${dir}/model.int8.onnx`,
          voices: `${dir}/voices.bin`,
          tokens: `${dir}/tokens.txt`,
          dataDir: `${dir}/espeak-ng-data`,
          lengthScale: 1.0,
        },
      };
    case 'supertonic-2':
      return {
        supertonic: {
          durationPredictor: `${dir}/duration_predictor.int8.onnx`,
          textEncoder: `${dir}/text_encoder.int8.onnx`,
          vectorEstimator: `${dir}/vector_estimator.int8.onnx`,
          vocoder: `${dir}/vocoder.int8.onnx`,
          ttsJson: `${dir}/tts.json`,
          unicodeIndexer: `${dir}/unicode_indexer.bin`,
          voiceStyle: `${dir}/voice.bin`,
        },
      };
    default:
      throw new Error(`Unknown TTS model ${model.id}`);
  }
}

async function loadTts(modelId: string, baseUrl: string): Promise<void> {
  if (ttsModel?.id === modelId && tts) return;
  const model = getModel(modelId);
  if (!model || model.kind !== 'tts') throw new Error(`Unknown TTS model ${modelId}`);

  const mod = await getModule(baseUrl);
  unloadTts();
  tts = await withModelFiles(mod, model, baseUrl, (dir) =>
    createOfflineTts(mod, {
      offlineTtsModelConfig: {
        ...ttsModelConfig(model, dir),
        numThreads: 1,
        debug: 0,
        provider: 'cpu',
      },
      maxNumSentences: 1,
    })
  );
  ttsModel = model;
}

function unloadTts(): void {
  tts?.free();
  tts = null;
  ttsModel = null;
}

function generate(text: string, sid: number, speed: number): { samples: Float32Array; sampleRate: number } {
  if (!tts || !ttsModel) throw new Error('No TTS model loaded');
  const audio = tts.generateWithConfig(text, {
    // Voice indexes differ per model (10 Supertonic, 8 Kitten); never pass one out of range
    sid: Math.min(Math.max(0, sid), Math.max(0, tts.numSpeakers - 1)),
    speed,
    ...(TTS_GENERATION_DEFAULTS[ttsModel.id] ?? {}),
  });
  return { samples: audio.samples, sampleRate: audio.sampleRate };
}

async function loadAsr(modelId: string, baseUrl: string): Promise<void> {
  if (asrModelId === modelId && recognizer) return;
  const model = getModel(modelId);
  if (!model || model.kind !== 'stt') throw new Error(`Unknown STT model ${modelId}`);

  const mod = await getModule(baseUrl);
  unloadAsr();
  recognizer = await withModelFiles(mod, model, baseUrl, (dir) =>
    createOnlineRecognizer(mod, {
      featConfig: { sampleRate: ASR_SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: `${dir}/encoder.onnx`,
          decoder: `${dir}/decoder.onnx`,
          joiner: `${dir}/joiner.onnx`,
        },
        paraformer: { encoder: '', decoder: '' },
        zipformer2Ctc: { model: '' },
        nemoCtc: { model: '' },
        toneCtc: { model: '' },
        tokens: `${dir}/tokens.txt`,
        numThreads: 1,
        provider: 'cpu',
        debug: 0,
        modelType: '',
        modelingUnit: '',
        bpeVocab: '',
      },
      decodingMethod: 'greedy_search',
      maxActivePaths: 4,
      enableEndpoint: 1,
      rule1MinTrailingSilence: 2.4,
      // Trailing silence after speech that ends an utterance
      rule2MinTrailingSilence: 0.8,
      rule3MinUtteranceLength: 20,
      hotwordsFile: '',
      hotwordsScore: 1.5,
      ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
      ruleFsts: '',
      ruleFars: '',
    })
  );
  asrModelId = modelId;
  resetAsr();
}

function unloadAsr(): void {
  asrStream?.free();
  asrStream = null;
  recognizer?.free();
  recognizer = null;
  asrModelId = null;
}

function resetAsr(): void {
  if (!recognizer) return;
  asrStream?.free();
  asrStream = recognizer.createStream();
  asrStream.acceptWaveform(
    micSampleRate,
    new Float32Array(Math.round(micSampleRate * ASR_LEADING_SILENCE_SECONDS))
  );
  lastPartial = '';
}

/** Kroko adds casing and punctuation; the command parser wants plain lowercase words. */
function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function acceptAudio(samples: Float32Array, sampleRate: number): void {
  if (!recognizer || !asrStream) return;
  if (sampleRate !== micSampleRate) {
    micSampleRate = sampleRate;
    resetAsr();
  }
  asrStream!.acceptWaveform(sampleRate, samples);
  while (recognizer.isReady(asrStream!)) {
    recognizer.decode(asrStream!);
  }

  const text = normalizeTranscript(recognizer.getResult(asrStream!).text);
  if (text && text !== lastPartial) {
    lastPartial = text;
    post({ type: 'asrPartial', text });
  }

  if (recognizer.isEndpoint(asrStream)) {
    if (text) post({ type: 'asrFinal', text });
    recognizer.reset(asrStream);
    lastPartial = '';
  }
}

// Requests run one at a time: loads await file reads, and without this a generate could
// run against a half-swapped model when the narrator is switched mid-speech
let requestQueue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<SherpaRequest>) => {
  const msg = event.data;

  // Streaming messages carry no id and get no reply
  if (msg.type === 'asrAudio') {
    try {
      acceptAudio(msg.samples, msg.sampleRate);
    } catch (err) {
      console.warn('[sherpa] ASR error:', err);
    }
    return;
  }
  if (msg.type === 'asrReset') {
    resetAsr();
    return;
  }

  requestQueue = requestQueue.then(() => handleRequest(msg));
};

async function handleRequest(msg: Exclude<SherpaRequest, { type: 'asrAudio' | 'asrReset' }>): Promise<void> {
  try {
    switch (msg.type) {
      case 'loadTts':
        await loadTts(msg.modelId, msg.baseUrl);
        post({ type: 'reply', id: msg.id, ok: true });
        break;
      case 'unloadTts':
        unloadTts();
        post({ type: 'reply', id: msg.id, ok: true });
        break;
      case 'generate': {
        const audio = generate(msg.text, msg.sid, msg.speed);
        post({ type: 'reply', id: msg.id, ok: true, audio }, [audio.samples.buffer]);
        break;
      }
      case 'loadAsr':
        await loadAsr(msg.modelId, msg.baseUrl);
        post({ type: 'reply', id: msg.id, ok: true });
        break;
      case 'unloadAsr':
        unloadAsr();
        post({ type: 'reply', id: msg.id, ok: true });
        break;
    }
  } catch (err) {
    post({ type: 'reply', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

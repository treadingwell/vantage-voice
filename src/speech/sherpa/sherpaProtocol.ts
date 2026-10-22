// Messages between SherpaClient (main thread) and sherpaWorker

export interface GeneratedSpeech {
  samples: Float32Array;
  sampleRate: number;
}

export type SherpaRequest =
  | { type: 'loadTts'; id: number; modelId: string; baseUrl: string }
  | { type: 'unloadTts'; id: number }
  | { type: 'generate'; id: number; text: string; sid: number; speed: number }
  | { type: 'loadAsr'; id: number; modelId: string; baseUrl: string }
  | { type: 'unloadAsr'; id: number }
  | { type: 'asrReset' }
  | { type: 'asrAudio'; samples: Float32Array; sampleRate: number };

export type SherpaWorkerMessage =
  | { type: 'reply'; id: number; ok: true; audio?: GeneratedSpeech }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'asrPartial'; text: string }
  | { type: 'asrFinal'; text: string };

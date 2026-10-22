// Minimal types for the vendored sherpa-onnx WASM runtime (see scripts/vendor-sherpa.mjs)

export interface SherpaFS {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
  rmdir(path: string): void;
  readdir(path: string): string[];
  isDir(mode: number): boolean;
  stat(path: string): { mode: number };
}

export interface SherpaModule {
  FS: SherpaFS;
  [key: string]: unknown;
}

export interface SherpaModuleInit {
  wasmBinary?: Uint8Array;
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
}

export interface GeneratedAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface OfflineTts {
  sampleRate: number;
  numSpeakers: number;
  generateWithConfig(text: string, config: Record<string, unknown>): GeneratedAudio;
  free(): void;
}

export interface OnlineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  inputFinished(): void;
  free(): void;
}

export interface OnlineRecognizer {
  createStream(): OnlineStream;
  isReady(stream: OnlineStream): boolean;
  decode(stream: OnlineStream): void;
  isEndpoint(stream: OnlineStream): boolean;
  reset(stream: OnlineStream): void;
  getResult(stream: OnlineStream): { text: string };
  free(): void;
}

// Типи для тієї частини sherpa-onnx-node, якою користуються прототипи етапу 0: пакет має лише JSDoc.
declare module 'sherpa-onnx-node' {
  export interface Wave {
    readonly samples: Float32Array;
    readonly sampleRate: number;
  }

  export interface OfflineRecognizerConfig {
    featConfig?: { sampleRate?: number; featureDim?: number };
    modelConfig: {
      transducer?: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads?: number;
      provider?: 'cpu' | 'cuda' | 'directml';
      debug?: number;
      modelType?: string;
    };
    decodingMethod?: 'greedy_search' | 'modified_beam_search';
  }

  export class OfflineStream {
    acceptWaveform(wave: Wave): void;
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(hotwords?: string): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): { text: string };
  }

  export class OnlineStream {
    acceptWaveform(wave: Wave): void;
    inputFinished(): void;
  }

  export interface SpeakerEmbeddingExtractorConfig {
    model: string;
    numThreads?: number;
    debug?: number;
    provider?: 'cpu' | 'cuda' | 'directml';
  }

  export class SpeakerEmbeddingExtractor {
    constructor(config: SpeakerEmbeddingExtractorConfig);
    readonly dim: number;
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    compute(stream: OnlineStream, enableExternalBuffer?: boolean): Float32Array;
  }

  export interface OfflineTtsConfig {
    model: {
      vits: {
        model: string;
        tokens: string;
        dataDir?: string;
        lexicon?: string;
        noiseScale?: number;
        noiseScaleW?: number;
        lengthScale?: number;
      };
      numThreads?: number;
      debug?: number;
      provider?: 'cpu' | 'cuda' | 'directml';
    };
    maxNumSentences?: number;
  }

  export class OfflineTts {
    constructor(config: OfflineTtsConfig);
    readonly numSpeakers: number;
    readonly sampleRate: number;
    generate(request: { text: string; sid: number; speed: number }): Wave;
  }

  export interface KeywordSpotterConfig {
    featConfig?: { sampleRate?: number; featureDim?: number };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads?: number;
      provider?: 'cpu' | 'cuda' | 'directml';
      debug?: number;
    };
    keywordsFile: string;
    keywordsScore?: number;
    keywordsThreshold?: number;
    numTrailingBlanks?: number;
    maxActivePaths?: number;
  }

  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): {
      keyword: string;
      start_time: number;
      tokens: string[];
      timestamps: number[];
    };
  }

  export interface VadConfig {
    sileroVad: {
      model: string;
      threshold?: number;
      minSpeechDuration?: number;
      minSilenceDuration?: number;
      windowSize?: number;
    };
    sampleRate: number;
    numThreads?: number;
    debug?: boolean | number;
  }

  /** Silero VAD: відрізки мови з потоку звуку. */
  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isDetected(): boolean;
    isEmpty(): boolean;
    front(): { samples: Float32Array; start: number };
    pop(): void;
    flush(): void;
    reset(): void;
  }

  export function readWave(path: string): Wave;
  export function writeWave(path: string, wave: Wave): boolean;
  export const version: string;

  const sherpa: {
    OfflineRecognizer: typeof OfflineRecognizer;
    SpeakerEmbeddingExtractor: typeof SpeakerEmbeddingExtractor;
    OfflineTts: typeof OfflineTts;
    KeywordSpotter: typeof KeywordSpotter;
    Vad: typeof Vad;
    readWave: typeof readWave;
    writeWave: typeof writeWave;
    version: string;
  };
  export default sherpa;
}

import {
  KittenTTSConfig,
  OUTPUT_SAMPLE_RATE,
  type ResolvedKittenTTSConfig,
  resolveConfig,
} from './KittenTTSConfig.web';
import {
  KittenTTSError,
  KittenTTSErrorCode,
  isKittenTTSError,
} from './KittenTTSError';
import { KittenTTSResult } from './KittenTTSResult';
import { KittenModel, speedPrior } from './KittenModel';
import { KittenVoice, type KittenTTSVoiceInput, normalizeVoice } from './KittenVoice';
import type { KittenWordTiming } from './KittenWordTiming';
import { TTSEngine } from './engine/TTSEngine.web';
import { splitSentences } from './engine/SentenceSplitter';
import { joinTimestamps } from './engine/TimestampJoiner';
import { loadNPZ, loadNPZData } from './loader/NPZLoader.web';
import {
  clearModelCache as deleteCachedModel,
  getModelCacheInfo,
  getProvidedModelCacheInfo,
  isModelCached as checkModelCached,
  type ModelCacheInfo,
  type ModelPaths,
  type ProgressHandler,
  resolveModelPaths,
} from './loader/ModelDownloader.web';
import {
  AudioOutput,
  type AudioPlayer,
  type AudioPlayOptions,
} from './audio/AudioOutput.web';

/** Options for {@link KittenTTS.create}. */
export interface KittenTTSCreateOptions extends KittenTTSConfig {
  /**
   * Delete cached model files and download fresh copies before initialising.
   * Useful after a failed/interrupted first-run setup.
   */
  forceRedownload?: boolean;

  /**
   * Audio player for the `speak()` and `play()` methods.
   *
   * Use {@link createBrowserAudioPlayer} in browser apps, or provide your own
   * implementation for frameworks, workers, or Node.js.
   *
   * @example
   * ```typescript
   * import { KittenTTS, createBrowserAudioPlayer } from '@kittentts/react-native';
   *
   * const tts = await KittenTTS.create({
   *   player: createBrowserAudioPlayer(),
   * });
   * await tts.speak('Hello!');
   * ```
   */
  player?: AudioPlayer;
}

export interface KittenTTSGenerateOptions {
  voice?: KittenTTSVoiceInput;
  speed?: number;
}

export interface KittenTTSSpeakOptions extends KittenTTSGenerateOptions, AudioPlayOptions {}

/**
 * The KittenTTS speech-synthesis engine for React Native Web runtimes.
 *
 * Downloads the model on first use, initialises ONNX Runtime inference,
 * and exposes an async API for generating and playing speech.
 *
 * @example
 * ```typescript
 * import { KittenTTS, createBrowserAudioPlayer } from '@kittentts/react-native';
 *
 * const tts = await KittenTTS.create({
 *   player: createBrowserAudioPlayer(),
 * });
 *
 * // Generate audio
 * const result = await tts.generate('Hello from KittenTTS!');
 *
 * // Play through speakers
 * await tts.speak('Good morning!');
 * ```
 */
export class KittenTTS {
  /** The configuration this instance was created with. */
  readonly config: ResolvedKittenTTSConfig;

  private engine: TTSEngine;
  private audioOutput: AudioOutput;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  private constructor(
    engine: TTSEngine,
    config: ResolvedKittenTTSConfig,
    player?: AudioPlayer,
  ) {
    this.engine = engine;
    this.config = config;
    this.audioOutput = new AudioOutput(player);
  }

  /**
   * Create and initialise a KittenTTS instance.
   *
   * Downloads all required files if not cached, loads the ONNX model, and
   * prepares the engine for inference.
   *
   * @param options - Configuration and player for this session.
   * @param onProgress - Optional callback for download progress [0, 1].
   * @returns A ready-to-use KittenTTS instance.
   */
  static async create(
    options?: KittenTTSCreateOptions,
    onProgress?: ProgressHandler,
  ): Promise<KittenTTS> {
    const resolved = resolveConfig(options);
    const hasPhonemizerDownload =
      typeof resolved.phonemizer.downloadIfNeeded === 'function';
    const setupProgress = createAggregateProgress(onProgress);

    const phonemizerDownload = hasPhonemizerDownload
      ? resolved.phonemizer.downloadIfNeeded?.(
        resolved.storageDirectory,
        setupProgress,
      )
      : Promise.resolve();

    const modelDownload = resolveModelPaths(
      resolved.model,
      resolved.storageDirectory,
      setupProgress,
      {
        modelFiles: resolved.modelFiles,
        force: options?.forceRedownload ?? false,
        retries: resolved.downloadRetries,
        baseURL: resolved.modelBaseURL || undefined,
        storage: resolved.storage,
        fetch: resolved.fetch,
      },
    );

    const [, downloadedPaths] = await Promise.all([
      phonemizerDownload,
      modelDownload,
    ]);
    setupProgress(1, { stage: 'complete' });

    let paths = downloadedPaths;
    const repairCache = async (): Promise<ModelPaths> => {
      await deleteCachedModel(
        resolved.model,
        resolved.storageDirectory,
        resolved.storage,
      );
      return resolveModelPaths(
        resolved.model,
        resolved.storageDirectory,
        setupProgress,
        {
          force: true,
          retries: resolved.downloadRetries,
          baseURL: resolved.modelBaseURL || undefined,
          storage: resolved.storage,
          fetch: resolved.fetch,
        },
      );
    };

    let voices = await loadVoicesWithCacheRepair(paths, repairCache);
    let engine: TTSEngine;
    try {
      engine = await TTSEngine.create(resolveOnnxModelSource(paths), voices, resolved);
    } catch (error) {
      if (resolved.modelFiles || !isRepairableModelCacheError(error)) throw error;
      paths = await repairCache();
      voices = await loadVoicesFromModelPaths(paths);
      engine = await TTSEngine.create(resolveOnnxModelSource(paths), voices, resolved);
    }

    return new KittenTTS(engine, resolved, options?.player);
  }

  /**
   * Synthesise speech for the given text.
   *
   * @param text - The English text to synthesise. Must not be empty.
   * @param voice - The voice to use. Defaults to the config's `defaultVoice`.
   * @param speed - Speed multiplier (0.5--2.0). Defaults to the config's `speed`.
   * @returns A {@link KittenTTSResult} containing PCM samples and metadata.
   */
  async generate(text: string, options?: KittenTTSGenerateOptions): Promise<KittenTTSResult>;
  async generate(text: string, voice?: KittenTTSVoiceInput, speed?: number): Promise<KittenTTSResult>;
  async generate(
    text: string,
    optionsOrVoice?: KittenTTSGenerateOptions | KittenTTSVoiceInput,
    legacySpeed?: number,
  ): Promise<KittenTTSResult> {
    if (this.disposed) throw KittenTTSError.engineNotReady();

    const trimmed = text.trim();
    if (!trimmed) throw KittenTTSError.emptyInput();

    const options = normalizeGenerateOptions(optionsOrVoice, legacySpeed);
    const selectedVoice = normalizeVoice(options.voice ?? this.config.defaultVoice);
    const selectedSpeed = Math.min(Math.max(options.speed ?? this.config.speed, 0.5), 2.0);

    const output = await this.engine.generate(
      trimmed,
      selectedVoice,
      selectedSpeed,
    );
    const effectiveSpeed = selectedSpeed * speedPrior(this.config.model, selectedVoice);
    const wordTimings = normalizeWordTimingsToDuration(
      joinTimestamps(trimmed, output.phonemes, output.durations),
      output.samples.length / OUTPUT_SAMPLE_RATE,
    );

    return new KittenTTSResult(
      output.samples,
      OUTPUT_SAMPLE_RATE,
      selectedVoice,
      effectiveSpeed,
      trimmed,
      wordTimings,
    );
  }

  /**
   * Synthesise speech sentence by sentence.
   *
   * This is the streaming counterpart to {@link generate}. It yields each
   * {@link KittenTTSResult} as soon as that sentence is ready, which lets apps
   * start playback before a long text has fully generated.
   */
  generateStreaming(text: string, options?: KittenTTSGenerateOptions): AsyncGenerator<KittenTTSResult, void, void>;
  generateStreaming(text: string, voice?: KittenTTSVoiceInput, speed?: number): AsyncGenerator<KittenTTSResult, void, void>;
  async *generateStreaming(
    text: string,
    optionsOrVoice?: KittenTTSGenerateOptions | KittenTTSVoiceInput,
    legacySpeed?: number,
  ): AsyncGenerator<KittenTTSResult, void, void> {
    if (this.disposed) throw KittenTTSError.engineNotReady();

    const trimmed = text.trim();
    if (!trimmed) throw KittenTTSError.emptyInput();

    const options = normalizeGenerateOptions(optionsOrVoice, legacySpeed);
    const selectedVoice = normalizeVoice(options.voice ?? this.config.defaultVoice);
    const selectedSpeed = Math.min(Math.max(options.speed ?? this.config.speed, 0.5), 2.0);
    for (const sentence of splitSentences(trimmed)) {
      yield await this.generate(sentence, selectedVoice, selectedSpeed);
    }
  }

  stream(text: string, options?: KittenTTSGenerateOptions): AsyncGenerator<KittenTTSResult, void, void>;
  stream(text: string, voice?: KittenTTSVoiceInput, speed?: number): AsyncGenerator<KittenTTSResult, void, void>;
  stream(
    text: string,
    optionsOrVoice?: KittenTTSGenerateOptions | KittenTTSVoiceInput,
    legacySpeed?: number,
  ): AsyncGenerator<KittenTTSResult, void, void> {
    return this.generateStreaming(text, optionsOrVoice as KittenTTSVoiceInput, legacySpeed);
  }

  /**
   * Synthesise and play speech through the device speakers.
   *
   * Requires an {@link AudioPlayer} to be passed via `KittenTTS.create({ player })`.
   *
   * @param text - The English text to synthesise.
   * @param voice - The voice to use.
   * @param speed - Speed multiplier (0.5--2.0).
   * @returns The generated {@link KittenTTSResult}.
   */
  async speak(text: string, options?: KittenTTSSpeakOptions): Promise<KittenTTSResult>;
  async speak(text: string, voice?: KittenTTSVoiceInput, speed?: number): Promise<KittenTTSResult>;
  async speak(
    text: string,
    optionsOrVoice?: KittenTTSSpeakOptions | KittenTTSVoiceInput,
    legacySpeed?: number,
  ): Promise<KittenTTSResult> {
    const options = normalizeSpeakOptions(optionsOrVoice, legacySpeed);
    const result = await this.generate(text, options);
    await this.play(result, options);
    return result;
  }

  /**
   * Play a previously generated result.
   *
   * Use this when an app needs to inspect metadata such as `wordTimings` before
   * playback starts.
   */
  async play(
    result: KittenTTSResult,
    options: AudioPlayOptions = {},
  ): Promise<void> {
    if (this.disposed) throw KittenTTSError.engineNotReady();
    await this.audioOutput.play(result.samples, result.sampleRate, options);
  }

  /** Stop any currently active audio playback. */
  async stopSpeaking(): Promise<void> {
    await this.audioOutput.stop();
  }

  async stop(): Promise<void> {
    await this.stopSpeaking();
  }

  async pauseSpeaking(): Promise<void> {
    await this.audioOutput.pause();
  }

  async resumeSpeaking(): Promise<void> {
    await this.audioOutput.resume();
  }

  get isSpeaking(): boolean {
    return this.audioOutput.isPlaying();
  }

  /** Check if the model files are already cached on disk. */
  static async isModelCached(config?: KittenTTSConfig): Promise<boolean> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) {
      return (await getProvidedModelCacheInfo(
        resolved.model,
        resolved.modelFiles,
      )).isCached;
    }
    return checkModelCached(
      resolved.model,
      resolved.storageDirectory,
      resolved.storage,
    );
  }

  /** Detailed cache state for first-run UI. */
  static async getModelCacheInfo(
    config?: KittenTTSConfig,
  ): Promise<ModelCacheInfo> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) {
      return getProvidedModelCacheInfo(resolved.model, resolved.modelFiles);
    }
    return getModelCacheInfo(
      resolved.model,
      resolved.storageDirectory,
      resolved.storage,
    );
  }

  static async cacheInfo(config?: KittenTTSConfig): Promise<ModelCacheInfo> {
    return KittenTTS.getModelCacheInfo(config);
  }

  /** Alias for `isModelCached()` with clearer app-facing wording. */
  static async isModelDownloaded(config?: KittenTTSConfig): Promise<boolean> {
    return KittenTTS.isModelCached(config);
  }

  /** Delete cached files for the selected model. */
  static async clearModelCache(config?: KittenTTSConfig): Promise<void> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) return;
    await deleteCachedModel(
      resolved.model,
      resolved.storageDirectory,
      resolved.storage,
    );
  }

  /** Delete and download the selected model again. */
  static async redownloadModel(
    config?: KittenTTSConfig,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) {
      await resolveModelPaths(
        resolved.model,
        resolved.storageDirectory,
        onProgress,
        {
          modelFiles: resolved.modelFiles,
          storage: resolved.storage,
          fetch: resolved.fetch,
        },
      );
      return;
    }
    await deleteCachedModel(
      resolved.model,
      resolved.storageDirectory,
      resolved.storage,
    );
    await resolveModelPaths(
      resolved.model,
      resolved.storageDirectory,
      onProgress,
      {
        force: true,
        retries: resolved.downloadRetries,
        baseURL: resolved.modelBaseURL || undefined,
        storage: resolved.storage,
        fetch: resolved.fetch,
      },
    );
  }

  /** Download model and phonemizer assets without creating a long-lived engine. */
  static async predownload(
    config?: KittenTTSConfig,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    const resolved = resolveConfig(config);
    const hasPhonemizerDownload =
      typeof resolved.phonemizer.downloadIfNeeded === 'function';
    const setupProgress = createAggregateProgress(onProgress);

    const phonemizerDownload = hasPhonemizerDownload
      ? resolved.phonemizer.downloadIfNeeded?.(
        resolved.storageDirectory,
        setupProgress,
      )
      : Promise.resolve();

    const modelDownload = resolveModelPaths(
      resolved.model,
      resolved.storageDirectory,
      setupProgress,
      {
        modelFiles: resolved.modelFiles,
        retries: resolved.downloadRetries,
        baseURL: resolved.modelBaseURL || undefined,
        storage: resolved.storage,
        fetch: resolved.fetch,
      },
    );

    await Promise.all([phonemizerDownload, modelDownload]);
    setupProgress(1, { stage: 'complete' });
  }

  /** @deprecated Use `predownload()`. This method does not keep an engine warm. */
  static async prewarm(
    config?: KittenTTSConfig,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    await KittenTTS.predownload(config, onProgress);
  }

  static async validateAssets(config?: KittenTTSConfig): Promise<void> {
    const info = await KittenTTS.getModelCacheInfo(config);
    if (!info.isCached) {
      throw KittenTTSError.modelFileNotFound(info.directory);
    }
  }

  /** Release the ONNX session and free resources. */
  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      await this.audioOutput.stop().catch(() => {});
      await this.engine.dispose();
      this.config.phonemizer.dispose?.();
    })();
    return this.disposePromise;
  }
}

function normalizeGenerateOptions(
  optionsOrVoice?: KittenTTSGenerateOptions | KittenTTSVoiceInput,
  legacySpeed?: number,
): KittenTTSGenerateOptions {
  if (
    typeof optionsOrVoice === 'string' ||
    optionsOrVoice === undefined
  ) {
    return { voice: optionsOrVoice, speed: legacySpeed };
  }
  return optionsOrVoice;
}

function normalizeSpeakOptions(
  optionsOrVoice?: KittenTTSSpeakOptions | KittenTTSVoiceInput,
  legacySpeed?: number,
): KittenTTSSpeakOptions {
  return normalizeGenerateOptions(optionsOrVoice, legacySpeed) as KittenTTSSpeakOptions;
}

function normalizeWordTimingsToDuration(
  wordTimings: readonly KittenWordTiming[],
  audioDuration: number,
): KittenWordTiming[] {
  if (wordTimings.length === 0 || audioDuration <= 0) return [...wordTimings];

  const lastEndTime = wordTimings[wordTimings.length - 1].endTime;
  if (lastEndTime <= 0) return [...wordTimings];

  const scale = audioDuration / lastEndTime;
  return wordTimings.map(timing => ({
    ...timing,
    startTime: clampTime(timing.startTime * scale, audioDuration),
    endTime: clampTime(timing.endTime * scale, audioDuration),
  }));
}

function clampTime(value: number, audioDuration: number): number {
  return Math.max(0, Math.min(audioDuration, value));
}

function resolveOnnxModelSource(paths: ModelPaths): string | Uint8Array {
  if (paths.onnxData) return paths.onnxData;
  if (paths.onnxPath) return paths.onnxPath;
  throw KittenTTSError.modelFileNotFound('<missing model path>');
}

async function loadVoicesFromModelPaths(
  paths: ModelPaths,
): Promise<Awaited<ReturnType<typeof loadNPZ>>> {
  if (paths.voicesData) return loadNPZData(paths.voicesData);
  if (paths.voicesPath) return loadNPZ(paths.voicesPath);
  throw KittenTTSError.voicesFileNotFound('<missing voices path>');
}

async function loadVoicesWithCacheRepair(
  paths: ModelPaths,
  repairCache: () => Promise<ModelPaths>,
): Promise<Awaited<ReturnType<typeof loadNPZ>>> {
  try {
    return await loadVoicesFromModelPaths(paths);
  } catch (error) {
    if (!isRepairableModelCacheError(error)) throw error;
    const repairedPaths = await repairCache();
    return loadVoicesFromModelPaths(repairedPaths);
  }
}

function isRepairableModelCacheError(error: unknown): boolean {
  return (
    isKittenTTSError(error) &&
    (error.code === KittenTTSErrorCode.InvalidModelData ||
      error.code === KittenTTSErrorCode.VoicesFileNotFound ||
      error.code === KittenTTSErrorCode.ModelFileNotFound ||
      error.code === KittenTTSErrorCode.InferenceFailed)
  );
}

function createAggregateProgress(
  progressHandler?: ProgressHandler,
): ProgressHandler {
  const files = new Map<string, { bytesWritten: number; contentLength: number }>();

  return (progress, info) => {
    if (info?.asset && info.contentLength && info.contentLength > 0) {
      files.set(info.asset, {
        bytesWritten: Math.max(0, Math.min(info.bytesWritten ?? 0, info.contentLength)),
        contentLength: info.contentLength,
      });
    }

    const totalBytes = Array.from(files.values()).reduce(
      (sum, file) => sum + file.contentLength,
      0,
    );
    const writtenBytes = Array.from(files.values()).reduce(
      (sum, file) => sum + file.bytesWritten,
      0,
    );

    if (totalBytes > 0) {
      progressHandler?.(
        Math.max(0, Math.min(1, writtenBytes / totalBytes)),
        info,
      );
      return;
    }

    progressHandler?.(progress, info);
  };
}

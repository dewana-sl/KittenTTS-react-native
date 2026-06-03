import { NativeModules } from 'react-native';
import type { ResolvedKittenTTSConfig } from '../KittenTTSConfig';
import { KittenTTSError, errorMessage, isKittenTTSError } from '../KittenTTSError';
import { KittenVoice } from '../KittenVoice';
import { speedPrior } from '../KittenModel';
import { OUTPUT_SAMPLE_RATE } from '../KittenTTSConfig';
import { preprocess } from './TextPreprocessor';
import * as TextCleaner from './TextCleaner';
import type { TTSEngineOutput } from './TTSEngine';

interface NativeEngineModule {
  createModel(archPath: string, weightsPath: string): number | Promise<number>;
  destroyModel(modelId: number): void | Promise<void>;
  loadVoiceStyle(voicePath: string): Float32Array | number[] | Promise<Float32Array | number[]>;
  synthesize(
    modelId: number,
    tokenIds: Float32Array | number[],
    style: Float32Array | number[],
  ): Float32Array | number[] | Promise<Float32Array | number[]>;
}

export class NativeTTSEngine {
  private readonly native: NativeEngineModule;
  private readonly modelId: number;
  private readonly config: ResolvedKittenTTSConfig;
  private readonly voiceDirectoryPath: string;
  private readonly styleCache = new Map<KittenVoice, Float32Array>();
  private disposed = false;

  private constructor(
    native: NativeEngineModule,
    modelId: number,
    voiceDirectoryPath: string,
    config: ResolvedKittenTTSConfig,
  ) {
    this.native = native;
    this.modelId = modelId;
    this.voiceDirectoryPath = stripTrailingSlash(voiceDirectoryPath);
    this.config = config;
  }

  static async create(config: ResolvedKittenTTSConfig): Promise<NativeTTSEngine> {
    const files = config.nativeConfig.modelFiles;
    if (!files) {
      throw KittenTTSError.invalidModelData(
        'Native backend requires nativeConfig.modelFiles in this implementation.',
      );
    }

    const native = resolveNativeEngineModule();
    const modelId = await native.createModel(
      stripFileScheme(files.archPath),
      stripFileScheme(files.weightsPath),
    );
    return new NativeTTSEngine(
      native,
      Number(modelId),
      stripFileScheme(files.voiceDirectoryPath),
      config,
    );
  }

  async generate(
    text: string,
    voice: KittenVoice,
    speed: number,
  ): Promise<TTSEngineOutput> {
    if (this.disposed) throw KittenTTSError.engineNotReady();

    const normalised = preprocess(text);
    if (!normalised) throw KittenTTSError.emptyInput();

    let phonemes: string;
    try {
      phonemes = await this.config.phonemizer.phonemize(normalised);
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.phonemizerFailed(errorMessage(error), error);
    }

    try {
      const tokens = TextCleaner.encodeNative(phonemes);
      const chunks = this.splitIntoChunks(tokens);
      const speedMultiplier = this.config.applySpeedPriors
        ? speedPrior(this.config.model, voice)
        : 1.0;
      const effectiveSpeed = speed * speedMultiplier;
      const style = await this.styleForVoice(voice);

      const allChunks: Float32Array[] = [];
      for (const chunk of chunks) {
        const samples = toFloat32Array(await this.native.synthesize(
          this.modelId,
          chunk,
          style,
        ));
        allChunks.push(applySpeed(samples, effectiveSpeed));
      }

      const totalLength = allChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (totalLength === 0) throw KittenTTSError.emptyOutput();

      const result = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of allChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return { samples: result, durations: [], phonemes };
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.inferenceFailed(errorMessage(error), error);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.native.destroyModel(this.modelId);
    this.styleCache.clear();
  }

  private async styleForVoice(voice: KittenVoice): Promise<Float32Array> {
    const cached = this.styleCache.get(voice);
    if (cached) return cached;

    const path = `${this.voiceDirectoryPath}/${voice}.bin`;
    const style = toFloat32Array(await this.native.loadVoiceStyle(path));
    if (style.length < 256) {
      throw KittenTTSError.invalidModelData(`Invalid native voice style: ${path}`);
    }
    const firstStyle = style.slice(0, 256);
    this.styleCache.set(voice, firstStyle);
    return firstStyle;
  }

  private splitIntoChunks(tokens: Float32Array): Float32Array[] {
    if (tokens.length <= this.config.maxTokensPerChunk) {
      return [tokens];
    }

    const body = Array.from(tokens.slice(1, tokens.length - 1));
    const maxBody = Math.max(1, this.config.maxTokensPerChunk - 2);
    const chunks: Float32Array[] = [];
    for (let index = 0; index < body.length; index += maxBody) {
      chunks.push(Float32Array.from([
        TextCleaner.START_TOKEN_ID,
        ...body.slice(index, index + maxBody),
        TextCleaner.PAD_TOKEN_ID,
      ]));
    }
    return chunks;
  }
}

function resolveNativeEngineModule(): NativeEngineModule {
  const rnModule = NativeModules.KittenTTSNativeEngine as NativeEngineModule | undefined;
  if (rnModule) {
    return {
      createModel: rnModule.createModel.bind(rnModule),
      destroyModel: rnModule.destroyModel.bind(rnModule),
      loadVoiceStyle: rnModule.loadVoiceStyle.bind(rnModule),
      synthesize: (modelId, tokenIds, style) => rnModule.synthesize(
        modelId,
        Array.from(tokenIds),
        Array.from(style),
      ),
    };
  }

  const nodeRequire = typeof process !== 'undefined' && process.versions?.node
    ? (Function('return require')() as NodeRequire)
    : null;
  if (nodeRequire) {
    return nodeRequire('../../build/Release/kittentts_native') as NativeEngineModule;
  }

  throw KittenTTSError.inferenceFailed(
    'Native inference is not available in this runtime.',
  );
}

function toFloat32Array(value: Float32Array | number[]): Float32Array {
  return value instanceof Float32Array ? value : Float32Array.from(value);
}

function applySpeed(samples: Float32Array, speed: number): Float32Array {
  if (samples.length === 0 || Math.abs(speed - 1.0) < 1e-6 || speed <= 0) {
    return samples;
  }

  const outputCount = Math.max(1, Math.round(samples.length / speed));
  if (outputCount === samples.length) return samples;
  if (outputCount === 1) return Float32Array.of(samples[0]);

  const result = new Float32Array(outputCount);
  const maxIndex = samples.length - 1;
  for (let i = 0; i < outputCount; i += 1) {
    const position = (i * maxIndex) / (outputCount - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, maxIndex);
    const fraction = position - lower;
    result[i] = samples[lower] + (samples[upper] - samples[lower]) * fraction;
  }
  return result;
}

function stripFileScheme(filePath: string): string {
  return filePath.startsWith('file://') ? filePath.slice('file://'.length) : filePath;
}

function stripTrailingSlash(filePath: string): string {
  return filePath.replace(/\/+$/, '');
}

type NodeRequire = (id: string) => unknown;

import { KittenVoice, type KittenTTSVoiceInput, normalizeVoice } from './KittenVoice';

/**
 * Available KittenTTS model variants.
 *
 * Each variant trades off size, speed, and quality. All models produce
 * 24 kHz mono audio output.
 */
export enum KittenModel {
  /** The fp32 nano model (~56 MB, 15M parameters). Smallest and fastest. */
  Nano = 'kitten-tts-nano-0.8',
  /** The int8-quantised nano model (~25 MB, 15M parameters). Half the size of Nano. */
  NanoInt8 = 'kitten-tts-nano-0.8-int8',
  /** The micro model (~41 MB, 40M parameters). Higher quality than nano. */
  Micro = 'kitten-tts-micro-0.8',
  /** The mini model (~80 MB, 80M parameters). Highest quality available. */
  Mini = 'kitten-tts-mini-0.8',
}

/** Preferred public model IDs. */
export type KittenTTSModelId = 'nano' | 'nano-int8' | 'micro' | 'mini';

/** Accepted model value. String IDs are preferred; KittenModel is kept for compatibility. */
export type KittenTTSModelInput = KittenTTSModelId | KittenModel;

/** @deprecated Use KittenTTSModelId. */
export type KittenModelId = KittenTTSModelId;

/** @deprecated Use KittenTTSModelInput. */
export type KittenModelInput = KittenTTSModelInput;

/** Lightweight constants for autocomplete without enum-style names. */
export const model = {
  nano: 'nano',
  nanoInt8: 'nano-int8',
  micro: 'micro',
  mini: 'mini',
} as const;

/** Convert a preferred public model ID or legacy enum value into the internal repository ID. */
export function normalizeModel(model: KittenTTSModelInput): KittenModel {
  switch (model) {
    case 'nano':
      return KittenModel.Nano;
    case 'nano-int8':
      return KittenModel.NanoInt8;
    case 'micro':
      return KittenModel.Micro;
    case 'mini':
      return KittenModel.Mini;
    default:
      if (Object.values(KittenModel).includes(model as KittenModel)) {
        return model as KittenModel;
      }
      throw new Error(`Unknown KittenTTS model: ${model}`);
  }
}

/** Hugging Face repository ID for the given model. */
export function huggingFaceRepo(model: KittenTTSModelInput): string {
  return `KittenML/${normalizeModel(model)}`;
}

/** Base URL for direct file downloads from Hugging Face. */
export function huggingFaceBaseURL(model: KittenTTSModelInput): string {
  return `https://huggingface.co/${huggingFaceRepo(model)}/resolve/main`;
}

/** ONNX model filename within the HuggingFace repository. */
export function onnxFileName(model: KittenTTSModelInput): string {
  switch (normalizeModel(model)) {
    case KittenModel.Nano:
    case KittenModel.NanoInt8:
      return 'kitten_tts_nano_v0_8.onnx';
    case KittenModel.Micro:
      return 'kitten_tts_micro_v0_8.onnx';
    case KittenModel.Mini:
      return 'kitten_tts_mini_v0_8.onnx';
  }
}

/** Voice embeddings archive filename. */
export function voicesFileName(_model: KittenTTSModelInput): string {
  return 'voices.npz';
}

/** Approximate total download size in bytes. */
export function approximateDownloadBytes(model: KittenTTSModelInput): number {
  switch (normalizeModel(model)) {
    case KittenModel.Nano:
      return 59_000_000;
    case KittenModel.NanoInt8:
      return 28_000_000;
    case KittenModel.Micro:
      return 44_000_000;
    case KittenModel.Mini:
      return 83_000_000;
  }
}

/** Hardcoded per-voice speed multiplier matching the upstream model settings. */
export function speedPrior(model: KittenTTSModelInput, voice: KittenTTSVoiceInput): number {
  const selectedVoice = normalizeVoice(voice);
  switch (normalizeModel(model)) {
    case KittenModel.Nano:
    case KittenModel.NanoInt8:
      return selectedVoice === KittenVoice.Hugo ? 0.9 : 0.8;
    case KittenModel.Micro:
    case KittenModel.Mini:
      return 1.0;
  }
}

/** Human-readable display name. */
export function modelDisplayName(model: KittenTTSModelInput): string {
  switch (normalizeModel(model)) {
    case KittenModel.Nano:
      return 'Nano (fp32)';
    case KittenModel.NanoInt8:
      return 'Nano (int8)';
    case KittenModel.Micro:
      return 'Micro';
    case KittenModel.Mini:
      return 'Mini';
  }
}

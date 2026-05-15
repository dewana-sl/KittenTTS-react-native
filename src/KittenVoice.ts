/**
 * The eight voices bundled with KittenTTS models.
 *
 * Each voice has a unique character and gender. The raw value corresponds
 * to the voice key used in the model's `voices.npz` embeddings file.
 */
export enum KittenVoice {
  /** Bella -- female, warm and expressive. */
  Bella = 'expr-voice-2-f',
  /** Jasper -- male, clear and conversational. */
  Jasper = 'expr-voice-2-m',
  /** Luna -- female, calm and smooth. */
  Luna = 'expr-voice-3-f',
  /** Bruno -- male, deep and steady. */
  Bruno = 'expr-voice-3-m',
  /** Rosie -- female, bright and friendly. */
  Rosie = 'expr-voice-4-f',
  /** Hugo -- male, authoritative. */
  Hugo = 'expr-voice-4-m',
  /** Kiki -- female, lively and energetic. */
  Kiki = 'expr-voice-5-f',
  /** Leo -- male, relaxed and natural. */
  Leo = 'expr-voice-5-m',
}

/** Preferred public voice IDs. */
export type KittenTTSVoiceId =
  | 'bella'
  | 'jasper'
  | 'luna'
  | 'bruno'
  | 'rosie'
  | 'hugo'
  | 'kiki'
  | 'leo';

/** Accepted voice value. String IDs are preferred; KittenVoice is kept for compatibility. */
export type KittenTTSVoiceInput = KittenTTSVoiceId | KittenVoice;

/** @deprecated Use KittenTTSVoiceId. */
export type KittenVoiceId = KittenTTSVoiceId;

/** @deprecated Use KittenTTSVoiceInput. */
export type KittenVoiceInput = KittenTTSVoiceInput;

/** Lightweight constants for autocomplete without enum-style names. */
export const voice = {
  bella: 'bella',
  jasper: 'jasper',
  luna: 'luna',
  bruno: 'bruno',
  rosie: 'rosie',
  hugo: 'hugo',
  kiki: 'kiki',
  leo: 'leo',
} as const satisfies Record<KittenTTSVoiceId, KittenTTSVoiceId>;

/** All available voices. */
export const ALL_VOICES: KittenVoice[] = [
  KittenVoice.Bella,
  KittenVoice.Jasper,
  KittenVoice.Luna,
  KittenVoice.Bruno,
  KittenVoice.Rosie,
  KittenVoice.Hugo,
  KittenVoice.Kiki,
  KittenVoice.Leo,
];

/** All preferred public voice IDs. */
export const ALL_VOICE_IDS: KittenTTSVoiceId[] = [
  'bella',
  'jasper',
  'luna',
  'bruno',
  'rosie',
  'hugo',
  'kiki',
  'leo',
];

/** Convert a preferred public voice ID or legacy enum value into the internal embedding key. */
export function normalizeVoice(voice: KittenTTSVoiceInput): KittenVoice {
  switch (voice) {
    case 'bella':
      return KittenVoice.Bella;
    case 'jasper':
      return KittenVoice.Jasper;
    case 'luna':
      return KittenVoice.Luna;
    case 'bruno':
      return KittenVoice.Bruno;
    case 'rosie':
      return KittenVoice.Rosie;
    case 'hugo':
      return KittenVoice.Hugo;
    case 'kiki':
      return KittenVoice.Kiki;
    case 'leo':
      return KittenVoice.Leo;
    default:
      if (Object.values(KittenVoice).includes(voice as KittenVoice)) {
        return voice as KittenVoice;
      }
      throw new Error(`Unknown KittenTTS voice: ${voice}`);
  }
}

/** Human-readable display name for a voice. */
export function voiceDisplayName(voice: KittenTTSVoiceInput): string {
  switch (normalizeVoice(voice)) {
    case KittenVoice.Bella:
      return 'Bella';
    case KittenVoice.Jasper:
      return 'Jasper';
    case KittenVoice.Luna:
      return 'Luna';
    case KittenVoice.Bruno:
      return 'Bruno';
    case KittenVoice.Rosie:
      return 'Rosie';
    case KittenVoice.Hugo:
      return 'Hugo';
    case KittenVoice.Kiki:
      return 'Kiki';
    case KittenVoice.Leo:
      return 'Leo';
  }
}

/** Whether the voice is female. */
export function isFemaleVoice(voice: KittenTTSVoiceInput): boolean {
  return normalizeVoice(voice).endsWith('-f');
}

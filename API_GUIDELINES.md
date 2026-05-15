# KittenTTS Public API Guidelines

## Preferred API

Use typed string IDs and options objects:

```ts
const tts = await KittenTTS.create({
  model: 'mini',
  defaultVoice: 'luna',
  speed: 1.1,
  player: createExpoAudioPlayer(ExpoAudio),
});

const result = await tts.generate('Hello', {
  voice: 'luna',
  speed: 1.1,
});

await tts.play(result);
await tts.speak('Hello', { voice: 'bella', speed: 1.0 });

for await (const chunk of tts.stream(longText, { voice: 'luna' })) {
  await tts.play(chunk);
}
```

## Type Safety

Model and voice IDs must be string literal unions, not untyped strings:

```ts
type KittenTTSModelId = 'nano' | 'nano-int8' | 'micro' | 'mini';
type KittenTTSVoiceId = 'bella' | 'jasper' | 'luna' | 'bruno' | 'rosie' | 'hugo' | 'kiki' | 'leo';
```

Old `KittenModel.*`, `KittenVoice.*`, and positional `generate/speak` calls stay supported for published users, but examples should prefer strings.

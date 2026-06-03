#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const native = require('../build/Release/kittentts_native');
const TextCleaner = require('../lib/engine/TextCleaner');
const { WAVEncoder } = require('../lib/audio/WAVEncoder');

const SAMPLE_RATE = 24000;
const TEXT = 'The quick brown fox jumps over the lazy dog.';
const FIXED_IPA = 'ðə kwˈɪk bɹˈaʊn fˈɑːks dʒˈʌmps ˌoʊvɚ ðə lˈeɪzi dˈɑːɡ.';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function writeFileSyncRecursive(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

const cppRoot = arg('cpp-root', '/Volumes/DewansSSD/dev/projects/cpp-convnet-pvt');
const archPath = arg('arch', path.join(cppRoot, 'model_defs/kitten_fp32_15m_arch.json'));
const weightsPath = arg('weights', path.join(cppRoot, 'weights/kitten_fp32_15m.bin'));
const voicePath = arg('voice', path.join(cppRoot, 'weights/voices_kitten_15m/expr-voice-2-f.bin'));
const outputPath = arg(
  'out',
  path.join(process.cwd(), 'benchmark-audio/react-native-native.wav'),
);
const runs = Number(arg('runs', '12'));
const warmups = Number(arg('warmup', '2'));

const tokens = TextCleaner.encodeNative(FIXED_IPA);
const style = native.loadVoiceStyle(voicePath);
const modelId = native.createModel(archPath, weightsPath);

try {
  const synthesize = native.synthesizeProfile || ((id, tokenIds, voiceStyle) => ({
    audio: native.synthesize(id, tokenIds, voiceStyle),
    synthMs: null,
    copyMs: null,
  }));

  for (let i = 0; i < warmups; i += 1) {
    synthesize(modelId, tokens, style);
  }

  const times = [];
  const nativeTimes = [];
  const copyTimes = [];
  let audio = null;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    const result = synthesize(modelId, tokens, style);
    times.push((performance.now() - start) / 1000);
    audio = result.audio;
    if (result.synthMs != null) nativeTimes.push(result.synthMs / 1000);
    if (result.copyMs != null) copyTimes.push(result.copyMs / 1000);
  }

  const duration = audio.length / SAMPLE_RATE;
  const generationTime = times.reduce((sum, value) => sum + value, 0) / times.length;
  const wav = WAVEncoder.encode(audio, SAMPLE_RATE);
  writeFileSyncRecursive(outputPath, Buffer.from(wav));

  console.log(`text=${TEXT}`);
  console.log(`duration=${duration.toFixed(6)}`);
  console.log(`generation_time=${generationTime.toFixed(6)}`);
  console.log(`rtf=${(generationTime / duration).toFixed(6)}`);
  if (nativeTimes.length > 0) {
    const nativeTime = nativeTimes.reduce((sum, value) => sum + value, 0) / nativeTimes.length;
    const copyTime = copyTimes.reduce((sum, value) => sum + value, 0) / copyTimes.length;
    console.log(`native_synthesis_time=${nativeTime.toFixed(6)}`);
    console.log(`native_synthesis_rtf=${(nativeTime / duration).toFixed(6)}`);
    console.log(`node_copy_time=${copyTime.toFixed(6)}`);
  }
  console.log(`samples=${audio.length}`);
  console.log(`wav=${outputPath}`);
} finally {
  native.destroyModel(modelId);
}

const test = require('node:test');
const assert = require('node:assert/strict');

const TextCleaner = require('../lib/engine/TextCleaner');

const QUICK_BROWN_IPA =
  'ðə kwˈɪk bɹˈaʊn fˈɑːks dʒˈʌmps ˌoʊvɚ ðə lˈeɪzi dˈɑːɡ.';

const PYTHON_ONNX_TOKENS = [
  0, 81, 83, 16, 53, 65, 156, 102, 53, 16, 44, 123, 156, 43, 135,
  56, 16, 48, 156, 69, 158, 53, 61, 16, 46, 147, 156, 138, 55, 58,
  61, 16, 157, 57, 135, 64, 85, 16, 81, 83, 16, 54, 156, 47, 102,
  68, 51, 16, 46, 156, 69, 158, 92, 16, 4, 10, 0,
];

test('encodeTokenized matches Python ONNX quick-brown IPA token IDs', () => {
  assert.deepEqual(TextCleaner.encodeTokenized(QUICK_BROWN_IPA), PYTHON_ONNX_TOKENS);
});

test('encodeNative matches native quick-brown IPA token IDs', () => {
  assert.deepEqual(
    Array.from(TextCleaner.encodeNative(QUICK_BROWN_IPA)),
    PYTHON_ONNX_TOKENS.slice(0, -2).concat(0),
  );
});

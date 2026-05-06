import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav32f } from './wav.mjs';

const ascii = (bytes, offset, length) =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

test('rejects non-Float32Array input', () => {
  assert.throws(() => encodeWav32f([0.1, 0.2]), /Float32Array/);
  assert.throws(() => encodeWav32f(new Float64Array(4)), /Float32Array/);
});

test('header signatures are correct', () => {
  const wav = encodeWav32f(new Float32Array(8));
  assert.equal(ascii(wav, 0, 4), 'RIFF');
  assert.equal(ascii(wav, 8, 4), 'WAVE');
  assert.equal(ascii(wav, 12, 4), 'fmt ');
  // fact chunk lives after the 26-byte fmt chunk
  assert.equal(ascii(wav, 12 + 26, 4), 'fact');
  assert.equal(ascii(wav, 12 + 26 + 12, 4), 'data');
});

test('total length follows the documented formula', () => {
  // Header: 12 RIFF + 26 fmt + 12 fact + 8 data-header = 58 bytes
  for (const n of [0, 1, 100, 44100]) {
    const wav = encodeWav32f(new Float32Array(n), 44100);
    assert.equal(wav.byteLength, 58 + n * 4, `n=${n}`);
  }
});

test('fmt chunk has the right values for 32-bit float mono', () => {
  const wav = encodeWav32f(new Float32Array(10), 44100);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  // After "fmt " (offset 12) + chunk size (4 bytes) starts the fmt data at offset 20
  assert.equal(view.getUint32(16, true), 18, 'fmt chunk size');
  assert.equal(view.getUint16(20, true), 3, 'format=IEEE float');
  assert.equal(view.getUint16(22, true), 1, 'channels');
  assert.equal(view.getUint32(24, true), 44100, 'sample rate');
  assert.equal(view.getUint32(28, true), 44100 * 4, 'byte rate');
  assert.equal(view.getUint16(32, true), 4, 'block align');
  assert.equal(view.getUint16(34, true), 32, 'bits per sample');
  assert.equal(view.getUint16(36, true), 0, 'cbSize');
});

test('fact chunk contains the per-channel sample count', () => {
  const wav = encodeWav32f(new Float32Array(2048));
  const view = new DataView(wav.buffer);
  // fact chunk: signature at 38, size at 42, data at 46
  assert.equal(view.getUint32(42, true), 4, 'fact chunk size');
  assert.equal(view.getUint32(46, true), 2048, 'sample length');
});

test('data chunk size matches the float payload', () => {
  const wav = encodeWav32f(new Float32Array(1234));
  const view = new DataView(wav.buffer);
  // data header at offset 50 (12 + 26 + 12)
  assert.equal(ascii(wav, 50, 4), 'data');
  assert.equal(view.getUint32(54, true), 1234 * 4);
});

test('samples round-trip exactly through encode → re-read', () => {
  const original = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0, 0.123456, -0.987654]);
  const wav = encodeWav32f(original);
  const view = new DataView(wav.buffer);
  const dataStart = 58; // header total
  for (let i = 0; i < original.length; i++) {
    const got = view.getFloat32(dataStart + i * 4, true);
    assert.equal(got, original[i], `sample ${i}`);
  }
});

test('RIFF size field equals total - 8', () => {
  const wav = encodeWav32f(new Float32Array(500));
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(4, true), wav.byteLength - 8);
});

test('honors a non-default sample rate', () => {
  const wav = encodeWav32f(new Float32Array(10), 22050);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint32(28, true), 22050 * 4);
});

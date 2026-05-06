import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteToFreq, freqToSf, sfToFreq, noteToSf, sfToNearestNote, MAX_PLAYABLE_HZ, NOTES,
} from './notes.mjs';

const close = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

test('noteToFreq matches standard pitch reference', () => {
  assert.equal(noteToFreq('A', 4), 440);
  assert.ok(close(noteToFreq('C', 4), 261.63));
  assert.ok(close(noteToFreq('C', 0), 16.35));
  assert.ok(close(noteToFreq('G', 4), 392.0));
});

test('noteToFreq rejects unknown note names', () => {
  assert.throws(() => noteToFreq('H', 4), /unknown note/);
});

test('NOTES exports all 12 chromatic names', () => {
  assert.equal(NOTES.length, 12);
  assert.deepEqual(NOTES, ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']);
});

test('freqToSf agrees with the in-engine formula at known points', () => {
  // freq_hz = 3528 * (sf² + 0.001)
  // sf=0.5  → 3528 * 0.251  ≈ 885.5 Hz
  // sf=0.34 → 3528 * 0.1166 ≈ 411.4 Hz (user verified A4-ish by ear at 0.34-0.35)
  assert.ok(close(sfToFreq(0.5), 885.53, 0.05));
  assert.ok(close(sfToFreq(0.352), 440, 1.0)); // ~A4
  assert.ok(close(sfToFreq(0), 3.528, 0.01));  // sf=0 → bias floor
});

test('sfToFreq and freqToSf are mutual inverses in the playable range', () => {
  for (const sf of [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.99]) {
    const round = freqToSf(sfToFreq(sf));
    assert.ok(close(round, sf, 1e-4), `roundtrip sf=${sf} → ${round}`);
  }
});

test('freqToSf clamps above the saturation point', () => {
  assert.equal(freqToSf(MAX_PLAYABLE_HZ * 2), 1);
  assert.equal(freqToSf(99999), 1);
  assert.equal(freqToSf(0), 0);
  assert.equal(freqToSf(-100), 0);
});

test('noteToSf maps musical notes to the right sf range', () => {
  assert.ok(close(noteToSf('A', 4), 0.352, 0.005)); // ~440 Hz
  assert.ok(close(noteToSf('C', 1), 0.091, 0.005));
  assert.ok(close(noteToSf('C', 4), 0.270, 0.005));
});

test('noteToSf saturates for octaves above the playable range', () => {
  // C8 = ~4186 Hz, above the 3528 × (1 + .001) ceiling
  assert.equal(noteToSf('C', 8), 1);
});

test('sfToNearestNote round-trips through note→sf for in-range pitches', () => {
  const cases = [
    ['C', 1], ['G', 2], ['C', 4], ['A', 4], ['F#', 5], ['C', 6], ['B', 6],
  ];
  for (const [name, octave] of cases) {
    const sf = noteToSf(name, octave);
    const detected = sfToNearestNote(sf);
    assert.equal(detected.name, name, `${name}${octave}: got ${detected.name}${detected.octave}`);
    assert.equal(detected.octave, octave);
    assert.ok(Math.abs(detected.cents) < 1, `${name}${octave} cents: ${detected.cents}`);
  }
});

test('MAX_PLAYABLE_HZ is the saturation ceiling', () => {
  // Just under the cap should yield sf < 1; just over should clamp to 1.
  assert.ok(freqToSf(MAX_PLAYABLE_HZ - 1) < 1);
  assert.equal(freqToSf(MAX_PLAYABLE_HZ + 1000), 1);
});

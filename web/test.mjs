// Node test suite for the rfxgen JS bridge. Run with: node --test test.mjs
// (or `make test` from the web/ dir, which builds first).
//
// Determinism note: the C engine uses srand()/rand(). All "deterministic" tests call
// engine.seed(...) before doing work that depends on randomness. The seed is process-wide
// state — interleaving seeded preset calls between assertions is fine, but be careful if
// adding tests that run them in parallel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './bridge.mjs';

test('engine loads and reports correct struct size', async () => {
  const engine = await loadEngine();
  assert.equal(engine.PARAMS_SIZE, 96);
  assert.equal(engine.FIELDS.length, 24);
});

test('reset produces the documented default params', async () => {
  const engine = await loadEngine();
  const p = engine.reset();

  // ResetWaveParams hard-codes these; see src/rfxgen.h:220-265
  assert.equal(p.waveTypeValue, 0);
  assert.equal(p.attackTimeValue, 0);
  assert.equal(p.sustainPunchValue, 0);
  assert.equal(p.minFrequencyValue, 0);
  assert.equal(p.lpfCutoffValue, 1);
  assert.equal(p.hpfCutoffValue, 0);

  // 0.3f / 0.4f as f32 promote to specific f64 values
  assert.equal(p.sustainTimeValue, Math.fround(0.3));
  assert.equal(p.decayTimeValue, Math.fround(0.4));
  assert.equal(p.startFrequencyValue, Math.fround(0.3));

  // randSeed gets a random value in [0x1, 0xFFFE]
  assert.ok(p.randSeed >= 1 && p.randSeed <= 0xFFFE,
    `randSeed ${p.randSeed} out of range`);
});

test('every preset returns a complete params object with all 24 fields', async () => {
  const engine = await loadEngine();
  engine.seed(42);
  const presets = [
    'presetCoin', 'presetLaser', 'presetExplosion', 'presetPowerup',
    'presetHit', 'presetJump', 'presetBlip', 'presetRandom',
  ];
  for (const name of presets) {
    const p = engine[name]();
    for (const field of engine.FIELDS) {
      assert.ok(field in p, `${name}: missing field ${field}`);
      assert.equal(typeof p[field], 'number', `${name}.${field} not a number`);
      assert.ok(Number.isFinite(p[field]), `${name}.${field} not finite: ${p[field]}`);
    }
  }
});

test('seed makes preset generation deterministic', async () => {
  const engine = await loadEngine();
  engine.seed(123);
  const a = engine.presetCoin();
  engine.seed(123);
  const b = engine.presetCoin();
  assert.deepEqual(a, b);
});

test('different seeds produce different presets', async () => {
  const engine = await loadEngine();
  engine.seed(1);
  const a = engine.presetCoin();
  engine.seed(2);
  const b = engine.presetCoin();
  assert.notDeepEqual(a, b);
});

test('generate produces a non-empty Float32Array of audible samples', async () => {
  const engine = await loadEngine();
  engine.seed(1);
  const params = engine.presetCoin();
  const samples = engine.generate(params);

  assert.ok(samples instanceof Float32Array);
  assert.ok(samples.length > 0, 'should produce at least some samples');
  // Generation buffer is capped at 10s @ 44.1kHz (see RFXGEN_MAX_GEN_BUFFER_LENGTH)
  assert.ok(samples.length <= 10 * 44100, `length ${samples.length} exceeds max`);

  // Samples must be normalized to [-1, 1]
  let min = Infinity, max = -Infinity, nonzero = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] < min) min = samples[i];
    if (samples[i] > max) max = samples[i];
    if (samples[i] !== 0) nonzero++;
  }
  assert.ok(min >= -1 && max <= 1, `samples out of range: [${min}, ${max}]`);
  assert.ok(nonzero > 100, `expected audible content, got ${nonzero} non-zero samples`);
});

test('generate is byte-deterministic when randSeed is fixed in params', async () => {
  const engine = await loadEngine();
  engine.seed(1);
  const params = engine.presetCoin();
  // Repeated generation with the same params (which carry randSeed) must be identical
  // because GenerateWave re-seeds from params.randSeed at the top.
  const a = engine.generate(params);
  const b = engine.generate(params);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) assert.fail(`sample ${i} differs: ${a[i]} vs ${b[i]}`);
  }
});

test('mutate alters at least one field', async () => {
  const engine = await loadEngine();
  engine.seed(7);
  const before = engine.presetCoin();
  const after = engine.mutate(before);

  let differ = 0;
  for (const k of Object.keys(before)) {
    if (before[k] !== after[k]) differ++;
  }
  assert.ok(differ > 0, 'mutate should alter at least one field');
});

test('mutate does not modify the input object (returns a new one)', async () => {
  const engine = await loadEngine();
  engine.seed(7);
  const before = engine.presetCoin();
  const snapshot = { ...before };
  engine.mutate(before);
  assert.deepEqual(before, snapshot);
});

test('rfx serialize/parse round-trips losslessly', async () => {
  const engine = await loadEngine();
  engine.seed(9);
  const original = engine.presetExplosion();

  const bytes = engine.serializeRfx(original);
  assert.equal(bytes.byteLength, 104, 'rfx is 8-byte header + 96-byte struct');
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), 'rFX ');

  const restored = engine.parseRfx(bytes);
  assert.deepEqual(restored, original);
});

test('parseRfx rejects a bad signature', async () => {
  const engine = await loadEngine();
  const bad = new Uint8Array(104);
  bad[0] = 0x58;
  assert.throws(() => engine.parseRfx(bad), /signature/);
});

test('parseRfx rejects an unsupported version', async () => {
  const engine = await loadEngine();
  const buf = new ArrayBuffer(104);
  const view = new DataView(buf);
  view.setUint8(0, 0x72); view.setUint8(1, 0x46);
  view.setUint8(2, 0x58); view.setUint8(3, 0x20);
  view.setUint16(4, 999, true);
  view.setUint16(6, 96, true);
  assert.throws(() => engine.parseRfx(new Uint8Array(buf)), /version/);
});

test('parseRfx rejects an undersized buffer', async () => {
  const engine = await loadEngine();
  assert.throws(() => engine.parseRfx(new Uint8Array(50)), /too small/);
});

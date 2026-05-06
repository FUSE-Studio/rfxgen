// Ergonomic wrapper around the emscripten-built rfxgen engine.
//
// App code works with plain JS objects (one property per WaveParams field).
// Marshaling to/from the 96-byte WaveParams struct happens inside this module.
//
// IMPORTANT: FIELDS must match the WaveParams struct in src/rfxgen.h byte-for-byte.
// Reordering breaks .rfx file compatibility — those files dump the struct directly.

import createRfxgenEngine from './dist/rfxgen-engine.mjs';

const PARAMS_SIZE = 96;

// [name, byteOffset, type] — order matches src/rfxgen.h:79-124
const FIELDS = [
  ['randSeed',              0,  'i32'],
  ['waveTypeValue',         4,  'i32'],
  ['attackTimeValue',       8,  'f32'],
  ['sustainTimeValue',      12, 'f32'],
  ['sustainPunchValue',     16, 'f32'],
  ['decayTimeValue',        20, 'f32'],
  ['startFrequencyValue',   24, 'f32'],
  ['minFrequencyValue',     28, 'f32'],
  ['slideValue',            32, 'f32'],
  ['deltaSlideValue',       36, 'f32'],
  ['vibratoDepthValue',     40, 'f32'],
  ['vibratoSpeedValue',     44, 'f32'],
  ['changeAmountValue',     48, 'f32'],
  ['changeSpeedValue',      52, 'f32'],
  ['squareDutyValue',       56, 'f32'],
  ['dutySweepValue',        60, 'f32'],
  ['repeatSpeedValue',      64, 'f32'],
  ['phaserOffsetValue',     68, 'f32'],
  ['phaserSweepValue',      72, 'f32'],
  ['lpfCutoffValue',        76, 'f32'],
  ['lpfCutoffSweepValue',   80, 'f32'],
  ['lpfResonanceValue',     84, 'f32'],
  ['hpfCutoffValue',        88, 'f32'],
  ['hpfCutoffSweepValue',   92, 'f32'],
];

const RFX_HEADER_SIZE = 8;
const RFX_TOTAL_SIZE = RFX_HEADER_SIZE + PARAMS_SIZE;
const RFX_VERSION = 200;

function readParams(view, base) {
  const out = {};
  for (const [name, offset, type] of FIELDS) {
    out[name] = type === 'i32'
      ? view.getInt32(base + offset, true)
      : view.getFloat32(base + offset, true);
  }
  return out;
}

function writeParams(view, base, params) {
  for (const [name, offset, type] of FIELDS) {
    const v = params[name] ?? 0;
    if (type === 'i32') view.setInt32(base + offset, v | 0, true);
    else view.setFloat32(base + offset, +v, true);
  }
}

// HEAPU8.buffer can be replaced when ALLOW_MEMORY_GROWTH triggers — derive a fresh
// DataView every time we touch the heap rather than caching one.
function heapView(Module) {
  return new DataView(Module.HEAPU8.buffer);
}

export async function loadEngine(moduleOpts = {}) {
  const Module = await createRfxgenEngine(moduleOpts);

  const wasmSize = Module._engine_params_size();
  if (wasmSize !== PARAMS_SIZE) {
    throw new Error(`WaveParams size mismatch: JS expects ${PARAMS_SIZE}, WASM reports ${wasmSize}`);
  }

  // Long-lived scratch buffers. WASM heap pointers stay valid across growth events
  // (the heap grows in place) — only the JS-side ArrayBuffer view is replaced.
  const paramsPtr = Module._malloc(PARAMS_SIZE);
  const frameCountPtr = Module._malloc(4);

  function callFillingPreset(fn) {
    fn(paramsPtr);
    return readParams(heapView(Module), paramsPtr);
  }

  return {
    PARAMS_SIZE,
    FIELDS: FIELDS.map(([name]) => name),

    /** Seed the C-side rand() so subsequent presets/generation are deterministic. */
    seed(s) { Module._engine_seed(s >>> 0); },

    reset()           { return callFillingPreset(Module._engine_reset); },
    presetCoin()      { return callFillingPreset(Module._engine_preset_coin); },
    presetLaser()     { return callFillingPreset(Module._engine_preset_laser); },
    presetExplosion() { return callFillingPreset(Module._engine_preset_explosion); },
    presetPowerup()   { return callFillingPreset(Module._engine_preset_powerup); },
    presetHit()       { return callFillingPreset(Module._engine_preset_hit); },
    presetJump()      { return callFillingPreset(Module._engine_preset_jump); },
    presetBlip()      { return callFillingPreset(Module._engine_preset_blip); },
    presetRandom()    { return callFillingPreset(Module._engine_preset_random); },

    /** Returns a new params object with mutated values; does not modify the input. */
    mutate(params) {
      writeParams(heapView(Module), paramsPtr, params);
      Module._engine_mutate(paramsPtr);
      return readParams(heapView(Module), paramsPtr);
    },

    /** Generate a wave. Returns a Float32Array (copied out of the WASM heap). */
    generate(params) {
      writeParams(heapView(Module), paramsPtr, params);
      const ptr = Module._engine_generate(paramsPtr, frameCountPtr);
      // Re-derive view AFTER the call: the C side malloc'd a buffer up to
      // ~1.76MB which may have grown the heap and replaced HEAPU8.buffer.
      const view = heapView(Module);
      const frames = view.getUint32(frameCountPtr, true);
      const samples = new Float32Array(frames);
      samples.set(new Float32Array(Module.HEAPU8.buffer, ptr, frames));
      Module._engine_free(ptr);
      return samples;
    },

    /** Serialize params to .rfx file bytes (8-byte header + 96-byte struct). */
    serializeRfx(params) {
      const buf = new ArrayBuffer(RFX_TOTAL_SIZE);
      const view = new DataView(buf);
      view.setUint8(0, 0x72); // 'r'
      view.setUint8(1, 0x46); // 'F'
      view.setUint8(2, 0x58); // 'X'
      view.setUint8(3, 0x20); // ' '
      view.setUint16(4, RFX_VERSION, true);
      view.setUint16(6, PARAMS_SIZE, true);
      writeParams(view, RFX_HEADER_SIZE, params);
      return new Uint8Array(buf);
    },

    /** Parse .rfx file bytes back into a params object. */
    parseRfx(bytes) {
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (arr.byteLength < RFX_TOTAL_SIZE) {
        throw new Error(`rfx file too small: ${arr.byteLength} < ${RFX_TOTAL_SIZE}`);
      }
      const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      const sig = String.fromCharCode(arr[0], arr[1], arr[2], arr[3]);
      if (sig !== 'rFX ') throw new Error(`invalid rfx signature: "${sig}"`);
      const version = view.getUint16(4, true);
      if (version !== RFX_VERSION) throw new Error(`unsupported rfx version: ${version}`);
      const length = view.getUint16(6, true);
      if (length !== PARAMS_SIZE) throw new Error(`unexpected payload length: ${length}`);
      return readParams(view, RFX_HEADER_SIZE);
    },
  };
}

// Note ↔ frequency ↔ sfxr-sf helpers.
//
// The engine's `startFrequencyValue` (sf) is a magic 0..1 number, NOT Hz. The
// underlying relationship (with 8× supersampling baked in, see GenerateWave):
//
//   freq_hz = 3528 × (sf² + 0.001)
//   sf      = √(freq_hz / 3528 − 0.001)
//
// sf saturates at 1.0 → ~3531 Hz (~A7+). Above that, no representation exists.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAME_TO_SEMITONE = Object.fromEntries(NOTE_NAMES.map((n, i) => [n, i]));

const A4_HZ = 440;
const A4_MIDI = 69;
const C0_MIDI = 12;

const SF_K = 3528;       // 44100 × 8 supersampling
const SF_BIAS = 0.001;   // see fperiod = 100 / (sf² + 0.001) in GenerateWave
const SF_MAX_HZ = SF_K * (1 + SF_BIAS); // ≈ 3531.5

/** Convert (note name, octave) → Hz. Octave is scientific pitch notation (A4 = 440). */
export function noteToFreq(name, octave) {
  const semitone = NAME_TO_SEMITONE[name];
  if (semitone === undefined) throw new Error(`unknown note: ${name}`);
  const midi = C0_MIDI + octave * 12 + semitone;
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Convert Hz → engine sf parameter, clamped to [0, 1]. Saturates above ~3531 Hz. */
export function freqToSf(hz) {
  if (hz <= 0) return 0;
  const sq = hz / SF_K - SF_BIAS;
  if (sq <= 0) return 0;
  const sf = Math.sqrt(sq);
  return sf > 1 ? 1 : sf;
}

/** Convert engine sf parameter → Hz. */
export function sfToFreq(sf) {
  return SF_K * (sf * sf + SF_BIAS);
}

/** Composition of noteToFreq + freqToSf. */
export function noteToSf(name, octave) {
  return freqToSf(noteToFreq(name, octave));
}

/** Largest note that fits inside sf ≤ 1.0. Useful for gating the keyboard UI. */
export const MAX_PLAYABLE_HZ = SF_MAX_HZ;

/**
 * Find the nearest equal-tempered note to a given sf value.
 * Returns { name, octave, cents } where cents is the deviation from the
 * exact note (-50..+50). Useful for displaying the current pitch.
 */
export function sfToNearestNote(sf) {
  const hz = sfToFreq(sf);
  if (hz <= 0) return { name: 'C', octave: 0, cents: 0 };
  const exactMidi = A4_MIDI + 12 * Math.log2(hz / A4_HZ);
  const midi = Math.round(exactMidi);
  const cents = (exactMidi - midi) * 100;
  const semitone = ((midi - C0_MIDI) % 12 + 12) % 12;
  const octave = Math.floor((midi - C0_MIDI) / 12);
  return { name: NOTE_NAMES[semitone], octave, cents };
}

export const NOTES = NOTE_NAMES;

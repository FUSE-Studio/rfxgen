// WAV encoder for engine output (32-bit IEEE float, mono).
//
// 32-bit float WAV is a non-PCM format, which per the WAVEFORMATEX spec means:
//   - fmt chunk is 18 bytes (16 + 2-byte cbSize=0), not 16 like classic PCM
//   - a "fact" chunk with the per-channel sample count is required
// Audacity, ffmpeg, and the Web Audio decoder all accept this layout cleanly.
//
// Layout (all little-endian):
//   12  RIFF header   "RIFF" + size + "WAVE"
//   26  fmt chunk     "fmt " + 18 + format + ch + rate + byteRate + align + bits + cbSize
//   12  fact chunk    "fact" + 4 + sampleLength
//    8  data header   "data" + size
//    N  samples       float32 little-endian × sample count

const RIFF_HEADER_SIZE = 12;
const FMT_CHUNK_SIZE = 26;   // 8-byte chunk header + 18 bytes of fmt data
const FACT_CHUNK_SIZE = 12;
const DATA_HEADER_SIZE = 8;
const HEADER_SIZE = RIFF_HEADER_SIZE + FMT_CHUNK_SIZE + FACT_CHUNK_SIZE + DATA_HEADER_SIZE;

const FORMAT_IEEE_FLOAT = 3;

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/**
 * Encode a Float32Array of mono samples as a 32-bit float WAV file.
 * Returns a Uint8Array. Samples are expected to be in [-1, 1] (the engine
 * already clamps to that range).
 */
export function encodeWav32f(samples, sampleRate = 44100) {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError('samples must be a Float32Array');
  }

  const numSamples = samples.length;
  const dataBytes = numSamples * 4;
  const totalSize = HEADER_SIZE + dataBytes;
  const out = new ArrayBuffer(totalSize);
  const view = new DataView(out);
  let off = 0;

  // RIFF
  writeAscii(view, off, 'RIFF');                          off += 4;
  view.setUint32(off, totalSize - 8, true);               off += 4;
  writeAscii(view, off, 'WAVE');                          off += 4;

  // fmt
  writeAscii(view, off, 'fmt ');                          off += 4;
  view.setUint32(off, 18, true);                          off += 4; // chunk size
  view.setUint16(off, FORMAT_IEEE_FLOAT, true);           off += 2;
  view.setUint16(off, 1, true);                           off += 2; // mono
  view.setUint32(off, sampleRate, true);                  off += 4;
  view.setUint32(off, sampleRate * 4, true);              off += 4; // byteRate = rate × blockAlign
  view.setUint16(off, 4, true);                           off += 2; // blockAlign = ch × bytesPerSample
  view.setUint16(off, 32, true);                          off += 2; // bitsPerSample
  view.setUint16(off, 0, true);                           off += 2; // cbSize

  // fact
  writeAscii(view, off, 'fact');                          off += 4;
  view.setUint32(off, 4, true);                           off += 4;
  view.setUint32(off, numSamples, true);                  off += 4;

  // data
  writeAscii(view, off, 'data');                          off += 4;
  view.setUint32(off, dataBytes, true);                   off += 4;
  for (let i = 0; i < numSamples; i++) {
    view.setFloat32(off, samples[i], true);
    off += 4;
  }

  return new Uint8Array(out);
}

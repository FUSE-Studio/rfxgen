// Web Audio playback for engine-generated Float32Array buffers.
//
// Browsers block AudioContext creation/resume until a user gesture, so the
// player lazily creates its context on first play(). The constructor accepts
// a `ctxFactory` for tests, defaulting to the real `AudioContext`.
//
// `play(samples)` always stops any in-flight source first, so rapid
// "play on change" updates from a slider drag don't pile up overlapping
// playback. Callers are responsible for debouncing the *generation* step
// (which is more expensive than playback).

const DEFAULT_FACTORY = () =>
  new (globalThis.AudioContext || globalThis.webkitAudioContext)();

export class AudioPlayer {
  constructor({ ctxFactory } = {}) {
    this._ctxFactory = ctxFactory ?? DEFAULT_FACTORY;
    this._ctx = null;
    this._source = null;
  }

  /** The underlying AudioContext, once created. May be null before first play(). */
  get context() { return this._ctx; }

  async _ensureContext() {
    if (!this._ctx) this._ctx = this._ctxFactory();
    if (this._ctx.state === 'suspended') await this._ctx.resume();
    return this._ctx;
  }

  /**
   * Play a Float32Array of mono samples. Stops any currently-playing source first.
   * The AudioContext resamples automatically if its native rate differs from
   * `sampleRate` (it usually will — engine is fixed at 44100, hardware is often 48000).
   */
  async play(samples, sampleRate = 44100) {
    const ctx = await this._ensureContext();
    this.stop();

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    if (typeof buffer.copyToChannel === 'function') {
      buffer.copyToChannel(samples, 0);
    } else {
      // Older browsers
      buffer.getChannelData(0).set(samples);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    source.onended = () => {
      if (this._source === source) this._source = null;
    };
    this._source = source;
    return source;
  }

  /** Stop the current playback, if any. Safe to call when nothing is playing. */
  stop() {
    if (!this._source) return;
    try { this._source.stop(); } catch (_) { /* already stopped */ }
    this._source = null;
  }

  /** Release the AudioContext. After this, a new one is created on next play(). */
  async close() {
    this.stop();
    if (this._ctx?.close) await this._ctx.close();
    this._ctx = null;
  }
}

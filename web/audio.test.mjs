// Headless tests for AudioPlayer using a mock AudioContext.
// These verify the player's wiring and lifecycle. Actual sound output is
// browser-only and gets exercised manually in the Alpine UI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayer } from './audio.mjs';

class MockBufferSource {
  constructor() { this.started = false; this.stopped = false; this.connected = null; }
  connect(dest) { this.connected = dest; }
  start() { this.started = true; }
  stop() {
    if (this.stopped) throw new Error('already stopped'); // mimics real BufferSource
    this.stopped = true;
  }
}

class MockBuffer {
  constructor(channels, length, rate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = rate;
    this._data = new Float32Array(length);
  }
  copyToChannel(arr, ch) {
    if (ch !== 0) throw new Error('mock supports only channel 0');
    this._data.set(arr);
  }
  getChannelData() { return this._data; }
}

class MockAudioContext {
  constructor({ initialState = 'running' } = {}) {
    this.state = initialState;
    this.destination = { __destination: true };
    this.buffersCreated = [];
    this.sourcesCreated = [];
    this.resumed = 0;
    this.closed = false;
  }
  async resume() { this.resumed++; this.state = 'running'; }
  async close() { this.closed = true; this.state = 'closed'; }
  createBuffer(ch, len, rate) {
    const b = new MockBuffer(ch, len, rate);
    this.buffersCreated.push(b);
    return b;
  }
  createBufferSource() {
    const s = new MockBufferSource();
    this.sourcesCreated.push(s);
    return s;
  }
}

function makePlayer(opts = {}) {
  const ctx = new MockAudioContext(opts);
  const player = new AudioPlayer({ ctxFactory: () => ctx });
  return { player, ctx };
}

test('play() lazily creates the context and resumes if suspended', async () => {
  const { player, ctx } = makePlayer({ initialState: 'suspended' });
  assert.equal(player.context, null);
  await player.play(new Float32Array(100));
  assert.equal(player.context, ctx);
  assert.equal(ctx.resumed, 1);
});

test("play() doesn't resume an already-running context", async () => {
  const { player, ctx } = makePlayer({ initialState: 'running' });
  await player.play(new Float32Array(100));
  assert.equal(ctx.resumed, 0);
});

test('play() copies samples into a mono buffer at the given rate', async () => {
  const { player, ctx } = makePlayer();
  const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  await player.play(samples, 44100);

  assert.equal(ctx.buffersCreated.length, 1);
  const buf = ctx.buffersCreated[0];
  assert.equal(buf.numberOfChannels, 1);
  assert.equal(buf.length, 4);
  assert.equal(buf.sampleRate, 44100);
  assert.deepEqual(Array.from(buf._data), [0.1, -0.2, 0.3, -0.4].map(Math.fround));
});

test('play() wires source → destination and starts it', async () => {
  const { player, ctx } = makePlayer();
  await player.play(new Float32Array(10));
  const src = ctx.sourcesCreated[0];
  assert.equal(src.connected, ctx.destination);
  assert.equal(src.started, true);
  assert.equal(src.stopped, false);
});

test('successive play() calls stop the previous source', async () => {
  const { player, ctx } = makePlayer();
  await player.play(new Float32Array(10));
  const first = ctx.sourcesCreated[0];
  await player.play(new Float32Array(10));
  const second = ctx.sourcesCreated[1];
  assert.equal(first.stopped, true);
  assert.equal(second.stopped, false);
});

test('stop() halts current playback and is a no-op afterward', async () => {
  const { player, ctx } = makePlayer();
  await player.play(new Float32Array(10));
  const src = ctx.sourcesCreated[0];
  player.stop();
  assert.equal(src.stopped, true);
  // Idempotent: calling again must not throw or double-stop the source.
  player.stop();
  assert.equal(src.stopped, true);
});

test('close() stops playback and closes the context', async () => {
  const { player, ctx } = makePlayer();
  await player.play(new Float32Array(10));
  await player.close();
  assert.equal(ctx.closed, true);
  assert.equal(player.context, null);
});

test('plays again after close() (creates a fresh context)', async () => {
  let ctxCount = 0;
  const player = new AudioPlayer({
    ctxFactory: () => { ctxCount++; return new MockAudioContext(); },
  });
  await player.play(new Float32Array(10));
  await player.close();
  await player.play(new Float32Array(10));
  assert.equal(ctxCount, 2);
});

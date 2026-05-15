// Alpine component wiring the engine, audio player, and DOM.
//
// Loaded as an ES module. Registers `Alpine.data('rfxgen', ...)` on alpine:init,
// which fires before Alpine evaluates any x-data attributes.

import { loadEngine } from './bridge.mjs';
import { AudioPlayer } from './audio.mjs';
import { encodeWav32f } from './wav.mjs';
import { noteToSf, sfToNearestNote, NOTES } from './notes.mjs';

const PRESET_BUTTONS = [
  { id: 'coin',      label: 'BEEP',   method: 'presetCoin' },
  { id: 'laser',     label: 'ZAP',    method: 'presetLaser' },
  { id: 'explosion', label: 'BOOM',   method: 'presetExplosion' },
  { id: 'powerup',   label: 'WOAH',   method: 'presetPowerup' },
  { id: 'hit',       label: 'UH OH',  method: 'presetHit' },
  { id: 'jump',      label: 'WHEE',   method: 'presetJump' },
  { id: 'blip',      label: 'BLIP',   method: 'presetBlip' },
  { id: 'random',    label: 'RANDOM', method: 'presetRandom' },
];

const WAVE_SHAPES = [
  { value: 0, label: 'Square' },
  { value: 1, label: 'Sawtooth' },
  { value: 2, label: 'Sine' },
  { value: 3, label: 'Noise' },
];

// Slider sections matching the wireframe. Note that "Phaser" parent slider
// intentionally controls repeatSpeedValue, not a phaser parameter — see the
// project UI decisions memory. Don't "fix" the label.
const SECTIONS = [
  { label: 'Slide', field: 'slideValue', min: -1, max: 1, advanced: [
    { label: 'Delta Slide', field: 'deltaSlideValue', min: -1, max: 1 },
  ]},
  { label: 'Vibrato', field: 'vibratoDepthValue', min: 0, max: 1, advanced: [
    { label: 'Speed', field: 'vibratoSpeedValue', min: 0, max: 1 },
  ]},
  { label: 'Change', field: 'changeAmountValue', min: -1, max: 1, advanced: [
    { label: 'Speed', field: 'changeSpeedValue', min: 0, max: 1 },
  ]},
  { label: 'Square', field: 'squareDutyValue', min: 0, max: 1, advanced: [] },
  { label: 'Phaser', field: 'repeatSpeedValue', min: 0, max: 1, advanced: [
    { label: 'Offset', field: 'phaserOffsetValue', min: -1, max: 1 },
    { label: 'Sweep',  field: 'phaserSweepValue',  min: -1, max: 1 },
  ]},
];

const MIN_OCTAVE = 1;
const MAX_OCTAVE = 7;       // C7 ≈ 2093 Hz, well inside sf ≤ 1; C8 saturates.
const REGEN_DEBOUNCE_MS = 50;

function defaultParams() {
  return {
    randSeed: 0, waveTypeValue: 0,
    attackTimeValue: 0, sustainTimeValue: 0.3, sustainPunchValue: 0, decayTimeValue: 0.4,
    startFrequencyValue: 0.3, minFrequencyValue: 0,
    slideValue: 0, deltaSlideValue: 0,
    vibratoDepthValue: 0, vibratoSpeedValue: 0,
    changeAmountValue: 0, changeSpeedValue: 0,
    squareDutyValue: 0, dutySweepValue: 0,
    repeatSpeedValue: 0,
    phaserOffsetValue: 0, phaserSweepValue: 0,
    lpfCutoffValue: 1, lpfCutoffSweepValue: 0, lpfResonanceValue: 0,
    hpfCutoffValue: 0, hpfCutoffSweepValue: 0,
  };
}

function readStoredTheme() {
  try {
    const t = localStorage.getItem('rfxgen-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch (_) {
    return 'system';
  }
}

function downloadBlob(bytes, filename, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function rfxgenComponent() {
  return {
    // ---- Static config exposed to templates ----
    PRESET_BUTTONS,
    WAVE_SHAPES,
    SECTIONS,
    NOTES,
    MIN_OCTAVE, MAX_OCTAVE,

    // ---- State ----
    engine: null,
    player: new AudioPlayer(),
    params: defaultParams(),
    currentNote: { name: 'A', octave: 4 },
    currentPreset: null,
    // Like currentPreset, but never cleared on slider tweaks. Used for
    // download filenames so a tweaked BEEP still saves as "sfx-beep.wav" —
    // it lives in the BEEP neighborhood of the parameter space, even if
    // the exact values have drifted.
    lastPreset: PRESET_BUTTONS[0].id,
    playOnChange: true,
    waveSamples: null,
    ready: false,
    error: null,
    theme: readStoredTheme(),    // 'system' | 'light' | 'dark'
    // Gate for the active preset's hover wobble. Reset to false on click
    // (suppresses the cue while the user is still hovering the button they
    // just clicked); flipped to true by @mouseleave on the active button so
    // a subsequent re-hover plays the wobble.
    wobbleArmed: true,
    _regenTimer: null,

    // ---- Lifecycle ----
    async init() {
      // Re-render the canvases when the OS color preference flips while we're
      // following system. Browser handles the CSS variable swap automatically;
      // we just need to redraw the JS-painted contents.
      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        mq.addEventListener?.('change', () => {
          this._drawWave();
          this._drawEnvelope();
        });
      }
      try {
        this.engine = await loadEngine();
        this.engine.seed(Date.now() & 0xffff);
        this.applyPreset(PRESET_BUTTONS[0]); // start with BEEP!
        this.ready = true;
      } catch (err) {
        this.error = err.message ?? String(err);
        console.error('engine load failed', err);
      }
    },

    // ---- Theme handling ----
    // Tristate cycle: system → light → dark → system → ...
    cycleTheme() {
      const next = { system: 'light', light: 'dark', dark: 'system' };
      this.theme = next[this.theme] ?? 'system';
      if (this.theme === 'system') {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.removeItem('rfxgen-theme'); } catch (_) {}
      } else {
        document.documentElement.setAttribute('data-theme', this.theme);
        try { localStorage.setItem('rfxgen-theme', this.theme); } catch (_) {}
      }
      // CSS variables are now swapped; redraw canvases that read them in JS.
      this._drawWave();
      this._drawEnvelope();
    },

    // ---- Preset / wave / note handlers ----
    // fromClick=true signals a real user click (vs. the init() seed call) —
    // only those should suppress the wobble until the cursor cycles away.
    applyPreset(p, fromClick = false) {
      this.params = this.engine[p.method]();
      this.currentPreset = p.id;
      this.lastPreset = p.id;
      this.currentNote = sfToNearestNote(this.params.startFrequencyValue);
      if (fromClick) this.wobbleArmed = false;
      this.regenerate();
    },

    setWave(value) {
      this.params.waveTypeValue = value;
      this.currentPreset = null;
      this.regenerate();
    },

    setNote(name) {
      this.currentNote.name = name;
      this.params.startFrequencyValue = noteToSf(name, this.currentNote.octave);
      this.currentPreset = null;
      this.regenerate();
    },

    bumpOctave(delta) {
      const next = this.currentNote.octave + delta;
      if (next < MIN_OCTAVE || next > MAX_OCTAVE) return;
      this.currentNote.octave = next;
      this.params.startFrequencyValue = noteToSf(this.currentNote.name, next);
      this.currentPreset = null;
      this.regenerate();
    },

    // Catch-all for slider/number-input changes. Clears preset highlight since
    // the user has now diverged from the preset.
    onParamChange() {
      this.currentPreset = null;
      this.regenerate();
    },

    // ---- Generation + playback ----
    regenerate() {
      clearTimeout(this._regenTimer);
      this._regenTimer = setTimeout(() => this._doRegenerate(), REGEN_DEBOUNCE_MS);
    },

    _doRegenerate() {
      if (!this.engine) return;
      this.waveSamples = this.engine.generate(this.params);
      this._drawWave();
      this._drawEnvelope();
      if (this.playOnChange) this.play();
    },

    async play() {
      if (!this.waveSamples) return;
      try {
        await this.player.play(this.waveSamples);
      } catch (err) {
        console.error('playback failed', err);
      }
    },

    download() {
      if (!this.waveSamples) return;
      // Slugify the most-recently-applied preset's label: "UH OH" → "uh-oh".
      // We use lastPreset (not currentPreset) so a tweaked BEEP still saves
      // as "sfx-beep.wav" — the parameter space around BEEP is conceptually
      // a "beep" even when slightly off the original preset values.
      const preset = PRESET_BUTTONS.find(p => p.id === this.lastPreset);
      const slug = preset ? preset.label.toLowerCase().replace(/\s+/g, '-') : 'sound';
      const wav = encodeWav32f(this.waveSamples);
      downloadBlob(wav, `sfx-${slug}.wav`, 'audio/wav');
    },

    // Designer hasn't confirmed this button's intent. Best guess: open a fresh tab.
    addNew() {
      window.open(window.location.href, '_blank');
    },

    // ---- Canvas rendering ----
    // Both canvases leave their pixels transparent so the CSS background of
    // each <canvas> shows through (set in styles.css). Foreground colors are
    // read from CSS custom properties at draw time, so theme tweaks
    // propagate without touching JS.
    _setupCanvas(canvas) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;     // resets all pixels to transparent
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx, w: rect.width, h: rect.height };
    },

    _cssVar(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },

    _drawWave() {
      const canvas = this.$refs.waveCanvas;
      if (!canvas) return;
      const { ctx, w, h } = this._setupCanvas(canvas);
      const samples = this.waveSamples;
      if (!samples?.length) return;
      ctx.fillStyle = this._cssVar('--accent');
      const step = samples.length / w;
      const mid = h / 2;
      for (let x = 0; x < w; x++) {
        const start = Math.floor(x * step);
        const end = Math.max(start + 1, Math.floor((x + 1) * step));
        let lo = 0, hi = 0;
        for (let i = start; i < end && i < samples.length; i++) {
          const s = samples[i];
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
        const yTop = mid - hi * mid;
        const yBot = mid - lo * mid;
        ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
      }
    },

    // Three-stage envelope shape preview: attack ramp, sustain (with optional
    // punch fade), decay ramp. Approximate — uses raw param values for relative
    // widths rather than the squared-time scaling that the engine uses internally.
    _drawEnvelope() {
      const canvas = this.$refs.envCanvas;
      if (!canvas) return;
      const { ctx, w, h } = this._setupCanvas(canvas);
      const a = Math.max(0.05, this.params.attackTimeValue);
      const s = Math.max(0.05, this.params.sustainTimeValue);
      const d = Math.max(0.05, this.params.decayTimeValue);
      const p = Math.max(0, Math.min(1, this.params.sustainPunchValue));
      const total = a + s + d;
      const px = (t) => (t / total) * w;
      const peak = h * 0.15;
      const sustainTop = h * (0.15 + p * 0.25);
      const baseline = h * 0.85;
      ctx.strokeStyle = this._cssVar('--accent');
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, baseline);
      ctx.lineTo(px(a), peak);                         // attack to peak
      ctx.lineTo(px(a + s), sustainTop);               // sustain w/ punch fade
      ctx.lineTo(px(a + s + d), baseline);             // decay to floor
      ctx.stroke();
    },

    // ---- Display helpers used in templates ----
    formatValue(v) {
      return Number(v).toFixed(2);
    },

    octaveLabel() {
      return `${this.currentNote.name.toLowerCase()}${this.currentNote.octave}`;
    },
  };
}

document.addEventListener('alpine:init', () => {
  window.Alpine.data('rfxgen', rfxgenComponent);
});

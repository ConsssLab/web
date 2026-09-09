/**
 * 全程序化音樂 —— 沒有任何音檔，靠 WebAudio 現場合成，所以 bundle 不會變重。
 * 瀏覽器規定要有使用者手勢才能出聲，所以 start() 一定從按鈕觸發。
 */

const SCALE = [0, 3, 5, 7, 10]; // 小調五聲，聽起來比較像日系配樂
const ROOT = 220; // A3
const BPM = 116;

const noteHz = (deg, oct = 0) =>
  ROOT * Math.pow(2, (SCALE[deg % 5] + 12 * (oct + Math.floor(deg / 5))) / 12);

class Engine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.timer = null;
    this.step = 0;
    this.enabled = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);
  }

  get ready() {
    return Boolean(this.ctx);
  }

  tone({
    freq,
    dur = 0.25,
    type = 'triangle',
    gain = 0.2,
    dest = null,
    detune = 0,
    attack = 0.01,
  }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.12, gain = 0.18, hp = 1200, dest = null }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src
      .connect(filter)
      .connect(g)
      .connect(dest || this.master);
    src.start(t);
  }

  // ---- BGM：4/4，pad + 琶音 + 簡單鼓組 ----
  loop() {
    const s = this.step++;
    const bar = Math.floor(s / 8) % 4;
    const chordRoot = [0, 3, 1, 4][bar];

    if (s % 8 === 0) {
      for (const d of [0, 2, 4]) {
        this.tone({
          freq: noteHz(chordRoot + d, -1),
          dur: 1.9,
          type: 'sine',
          gain: 0.07,
          dest: this.musicGain,
          attack: 0.3,
        });
      }
    }
    const arp = [0, 2, 4, 2, 3, 4, 2, 0][s % 8];
    this.tone({
      freq: noteHz(chordRoot + arp, 1),
      dur: 0.22,
      type: 'triangle',
      gain: 0.055,
      dest: this.musicGain,
    });
    if (s % 8 === 4) {
      this.tone({
        freq: noteHz(chordRoot + 4, 2),
        dur: 0.4,
        type: 'sine',
        gain: 0.04,
        dest: this.musicGain,
      });
    }
    if (s % 4 === 0)
      this.tone({ freq: 55, dur: 0.18, type: 'sine', gain: 0.22, dest: this.musicGain });
    if (s % 4 === 2) this.noise({ dur: 0.09, gain: 0.05, hp: 3000, dest: this.musicGain });
  }

  start() {
    this.init();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.enabled = true;
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(0.85, this.ctx.currentTime + 1.2);
    if (!this.timer) {
      const interval = (60 / BPM / 2) * 1000; // 八分音符
      this.timer = setInterval(() => this.loop(), interval);
    }
    return true;
  }

  stop() {
    this.enabled = false;
    if (!this.ctx) return;
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
    clearInterval(this.timer);
    this.timer = null;
  }

  toggle() {
    if (this.enabled) this.stop();
    else this.start();
    return this.enabled;
  }
}

const engine = new Engine();

export const music = {
  toggle: () => engine.toggle(),
  stop: () => engine.stop(),
  get enabled() {
    return engine.enabled;
  },
};

export const sfx = {
  tap() {
    engine.init();
    engine.tone({ freq: noteHz(2, 1), dur: 0.08, type: 'square', gain: 0.09 });
  },
  deploy() {
    engine.init();
    engine.tone({ freq: noteHz(0, 1), dur: 0.14, type: 'triangle', gain: 0.16 });
    engine.tone({ freq: noteHz(4, 1), dur: 0.2, type: 'triangle', gain: 0.12, detune: 6 });
  },
  clash() {
    engine.init();
    engine.noise({ dur: 0.16, gain: 0.22, hp: 900 });
    engine.tone({ freq: 130, dur: 0.16, type: 'sawtooth', gain: 0.1 });
  },
  hit() {
    engine.init();
    engine.tone({ freq: 82, dur: 0.28, type: 'sawtooth', gain: 0.2 });
    engine.noise({ dur: 0.2, gain: 0.14, hp: 500 });
  },
  spell() {
    engine.init();
    for (let i = 0; i < 5; i++) {
      setTimeout(
        () => engine.tone({ freq: noteHz(i, 1), dur: 0.22, type: 'sine', gain: 0.13 }),
        i * 45,
      );
    }
  },
  agent() {
    engine.init();
    engine.tone({ freq: noteHz(3, 0), dur: 0.1, type: 'square', gain: 0.07 });
    setTimeout(() => engine.tone({ freq: noteHz(1, 1), dur: 0.1, type: 'square', gain: 0.07 }), 90);
  },
  win() {
    engine.init();
    [0, 2, 4, 5].forEach((d, i) =>
      setTimeout(
        () => engine.tone({ freq: noteHz(d, 1), dur: 0.5, type: 'triangle', gain: 0.2 }),
        i * 130,
      ),
    );
  },
  lose() {
    engine.init();
    [4, 2, 1, 0].forEach((d, i) =>
      setTimeout(
        () => engine.tone({ freq: noteHz(d, -1), dur: 0.6, type: 'sawtooth', gain: 0.14 }),
        i * 170,
      ),
    );
  },
};

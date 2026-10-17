export type Mixer = {
  unlock: () => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  update: (speed: number, throttle: number, drift: boolean, boost: boolean) => void;
  hit: () => void;
  lap: () => void;
  boostSting: () => void;
  fanfare: () => void;
  dispose: () => void;
};

export function createMixer(): Mixer {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let engineGain: GainNode | null = null;
  let oscA: OscillatorNode | null = null;
  let oscB: OscillatorNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let driftGain: GainNode | null = null;
  let driftSrc: AudioBufferSourceNode | null = null;
  let volume = 0.8;
  let muted = false;

  function applyVol() {
    if (!master || !ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : volume * volume, ctx.currentTime, 0.03);
  }

  function unlock() {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: "interactive" });
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      oscA = ctx.createOscillator();
      oscB = ctx.createOscillator();
      oscA.type = "sawtooth";
      oscB.type = "triangle";
      oscB.detune.value = 7;
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.65;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(master);
      oscA.start();
      oscB.start();

      const n = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, n, n);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      driftSrc = ctx.createBufferSource();
      driftSrc.buffer = noiseBuf;
      driftSrc.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 880;
      bp.Q.value = 0.55;
      driftGain = ctx.createGain();
      driftGain.gain.value = 0;
      driftSrc.connect(bp);
      bp.connect(driftGain);
      driftGain.connect(master);
      driftSrc.start();
      applyVol();
    }
    if (ctx.state === "suspended") void ctx.resume();
  }

  function blip(freq: number, dur: number, type: OscillatorType, gainV: number, when = 0) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(40, freq), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), t0 + dur);
    g.gain.setValueAtTime(gainV, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  return {
    unlock,
    setVolume(v: number) {
      volume = Math.min(1, Math.max(0, v));
      applyVol();
    },
    setMuted(m: boolean) {
      muted = m;
      applyVol();
    },
    update(speed, throttle, drift, boost) {
      if (!ctx || !oscA || !oscB || !filter || !engineGain || !driftGain) return;
      const spd = Math.abs(speed);
      const f = 40 + spd * 2.35 + (throttle > 0 ? 14 : 0) + (boost ? 28 : 0);
      oscA.frequency.setTargetAtTime(f, ctx.currentTime, 0.04);
      oscB.frequency.setTargetAtTime(f * 0.5, ctx.currentTime, 0.05);
      filter.frequency.setTargetAtTime(200 + spd * 20 + (boost ? 380 : 0), ctx.currentTime, 0.05);
      const eg = Math.min(0.16, 0.015 + spd * 0.0036 + (throttle > 0 ? 0.028 : 0));
      engineGain.gain.setTargetAtTime(eg, ctx.currentTime, 0.05);
      driftGain.gain.setTargetAtTime(drift ? Math.min(0.11, 0.02 + spd * 0.0022) : 0, ctx.currentTime, 0.04);
    },
    hit() {
      if (!ctx || !master || !noiseBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 420;
      g.gain.setValueAtTime(0.28, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start();
      src.stop(ctx.currentTime + 0.18);
      src.onended = () => {
        src.disconnect();
        f.disconnect();
        g.disconnect();
      };
    },
    lap() {
      blip(620, 0.1, "square", 0.06, 0);
      blip(880, 0.14, "square", 0.05, 0.09);
    },
    boostSting() {
      blip(180, 0.32, "sawtooth", 0.09);
    },
    fanfare() {
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.24, "triangle", 0.07, i * 0.11));
    },
    dispose() {
      try {
        oscA?.stop();
        oscB?.stop();
        driftSrc?.stop();
      } catch {
        /* already stopped */
      }
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}

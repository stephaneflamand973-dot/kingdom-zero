// ─────────────────────────────────────────────────────────────
// Ambiance sonore procédurale (Web Audio) — aucun fichier externe.
// Vent filtré, oiseaux le jour, grillons les nuits d'été, rumeur de
// taverne, enclume à la forge ; petits bruitages pour les actions.
// Le son ne démarre qu'après un geste de l'utilisateur (règle des
// navigateurs) et peut être coupé à tout moment.
// ─────────────────────────────────────────────────────────────

export type Sfx = 'click' | 'coin' | 'fail' | 'bell' | 'eat' | 'hit' | 'page';
export interface Scene { hour: number; season: number; locKind: string; indoor: boolean; storm: boolean; muted: boolean; volume: number }

type Ctx = AudioContext;

class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private wind: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private murmur: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private scene: Scene | null = null;
  private noise: AudioBuffer | null = null;

  /** À appeler depuis un geste utilisateur (clic, touche). */
  unlock(): void {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try { this.ctx = new AC(); } catch { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.wind = this.loop(this.noise, 'lowpass', 420);
      this.murmur = this.loop(this.noise, 'bandpass', 520);
      window.setInterval(() => this.tick(), 700);
      if (this.scene) this.apply(this.scene);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // bruit brun (plus doux que le bruit blanc)
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    return buf;
  }

  private loop(buf: AudioBuffer, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = type === 'bandpass' ? 0.8 : 0.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return { src, filter, gain };
  }

  /** Met à jour l'ambiance selon l'heure, la saison et le lieu. */
  setScene(s: Scene): void {
    this.scene = s;
    if (this.ctx) this.apply(s);
  }

  private apply(s: Scene): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    this.master!.gain.setTargetAtTime(s.muted ? 0 : s.volume, t, 0.4);
    const night = s.hour >= 21 || s.hour < 6;
    const windLevel = s.indoor ? 0.015 : (s.season === 3 ? 0.11 : s.storm ? 0.09 : night ? 0.05 : 0.035);
    this.wind!.gain.gain.setTargetAtTime(windLevel, t, 1.2);
    this.wind!.filter.frequency.setTargetAtTime(s.season === 3 ? 650 : 380, t, 1.5);
    const crowd = s.locKind === 'tavern' && s.hour >= 11 ? (s.hour >= 17 ? 0.09 : 0.04) : s.locKind === 'market' && !night ? 0.03 : 0;
    this.murmur!.gain.gain.setTargetAtTime(crowd, t, 0.8);
  }

  /** Petits événements aléatoires de l'ambiance (oiseaux, grillons, enclume). */
  private tick(): void {
    const s = this.scene;
    if (!s || s.muted || !this.ready) return;
    const night = s.hour >= 21 || s.hour < 6;
    const outdoorSeason = s.season === 0 || s.season === 1;
    if (!s.indoor && !night && outdoorSeason && s.hour < 19 && Math.random() < 0.28) this.bird();
    if (!s.indoor && !night && s.season === 2 && Math.random() < 0.08) this.bird();
    if (!s.indoor && night && s.season === 1 && Math.random() < 0.5) this.cricket();
    if (s.locKind === 'forge' && !night && Math.random() < 0.3) this.anvil();
    if (s.locKind === 'tavern' && s.hour >= 17 && Math.random() < 0.12) this.clink();
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx!; const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator(); o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private bird(): void {
    const base = 2200 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(base * (1 + (Math.random() - 0.5) * 0.15), 0.09, { gain: 0.035, slide: 1.25, delay: i * 0.13 });
  }
  private cricket(): void { for (let i = 0; i < 3; i++) this.tone(4300, 0.04, { type: 'triangle', gain: 0.012, delay: i * 0.06 }); }
  private anvil(): void { this.tone(1250, 0.6, { type: 'triangle', gain: 0.05 }); this.tone(2900, 0.3, { gain: 0.02 }); }
  private clink(): void { this.tone(2600 + Math.random() * 600, 0.25, { gain: 0.025 }); }

  play(sfx: Sfx): void {
    const s = this.scene;
    if (!this.ready || s?.muted) return;
    switch (sfx) {
      case 'click': this.tone(660, 0.06, { type: 'triangle', gain: 0.05 }); break;
      case 'page': this.tone(320, 0.12, { type: 'triangle', gain: 0.04, slide: 0.7 }); break;
      case 'coin': this.tone(1568, 0.12, { type: 'square', gain: 0.03 }); this.tone(2093, 0.25, { type: 'square', gain: 0.03, delay: 0.07 }); break;
      case 'fail': this.tone(220, 0.22, { type: 'sawtooth', gain: 0.04, slide: 0.7 }); break;
      case 'eat': this.tone(180, 0.08, { type: 'triangle', gain: 0.06 }); this.tone(150, 0.08, { type: 'triangle', gain: 0.06, delay: 0.12 }); break;
      case 'hit': this.tone(110, 0.18, { type: 'square', gain: 0.08, slide: 0.5 }); break;
      case 'bell':
        for (const [f, d] of [[523, 0], [659, 0.18], [784, 0.36]] as const) {
          this.tone(f, 1.4, { gain: 0.06, delay: d }); this.tone(f * 2.76, 0.8, { gain: 0.015, delay: d });
        }
        break;
    }
  }
}

export const sound = new SoundEngine();

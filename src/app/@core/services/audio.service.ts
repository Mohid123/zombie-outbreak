import { Injectable, inject, signal } from '@angular/core';
import { AppState } from '../../app.state';

interface BgEl { el: HTMLAudioElement; target: number; }

@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly muted = signal(false);

  private state = inject(AppState);

  private amb: BgEl | null = null;
  private scr: BgEl | null = null;
  private dog: BgEl | null = null;
  private air: BgEl | null = null;

  private fadeId         = 0;
  private bgPreloaded    = false;
  private ambientStarted = false;

  private ctx: AudioContext | null = null;

  // Global click listener — retries play() on every user interaction.
  // This is the most reliable cross-browser unlock strategy.
  constructor() {
    const tryResume = () => {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      for (const t of [this.amb, this.scr, this.dog, this.air]) {
        if (t?.el.paused) t.el.play().catch(() => {});
      }
    };
    document.addEventListener('click',    tryResume, { passive: true });
    document.addEventListener('touchend', tryResume, { passive: true });
  }

  private getCtx(): AudioContext | null {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  }

  // Create element and start playing immediately (silent at volume 0).
  // Call from a user gesture so play() succeeds.
  preloadBg(): void {
    if (this.bgPreloaded) return;
    this.bgPreloaded = true;
    this.amb = this.mkEl('/ambience.mp3');
    this.scr = this.mkEl('/screaming.mp3');
    this.dog = this.mkEl('/dogs.mp3');
    this.air = this.mkEl('/air_raid.mp3');
  }

  private mkEl(src: string): BgEl {
    const el = new Audio(src);
    el.loop   = true;
    el.volume = 0;
    el.play().catch(() => {});
    return { el, target: 0 };
  }

  // Must be called inside a user-gesture (dropGroundZero is a map click or template click).
  startAmbient(): void {
    if (this.ambientStarted) return;
    this.ambientStarted = true;

    if (!this.bgPreloaded) this.preloadBg();

    // Explicitly play all elements — they may be paused after stopAll()
    for (const t of [this.amb, this.scr, this.dog, this.air]) {
      if (t) t.el.play().catch(() => {});
    }

    if (this.amb) this.amb.target = 0.75;

    this.fadeId = window.setInterval(() => this.bgFade(), 100);
  }

  private bgFade(): void {
    if (!this.ambientStarted) return;

    // Read live state and compute targets based on absolute affected count
    const aff = this.state.totalInfected() + this.state.totalZombie() + this.state.totalDead();
    const sq  = Math.sqrt(Math.max(0, aff));

    if (this.amb) this.amb.target = Math.max(0, 1 - sq / 30)  * 0.75;
    if (this.scr) this.scr.target = clamp01((sq - 3)  / 22)   * 0.85;
    if (this.dog) this.dog.target = clamp01((sq - 8)  / 22)   * 0.62;
    if (this.air) this.air.target = clamp01((sq - 20) / 30)   * 0.92;


    // Interpolate volumes toward targets.
    // If an element needs volume but is paused, try to resume it.
    for (const t of [this.amb, this.scr, this.dog, this.air]) {
      if (!t) continue;
      const want = this.muted() ? 0 : t.target;
      if (want > 0.02 && t.el.paused) {
        t.el.play().catch(() => {});
      }
      const diff = want - t.el.volume;
      if (Math.abs(diff) < 0.003) { t.el.volume = want; continue; }
      t.el.volume = Math.max(0, Math.min(1, t.el.volume + diff * 0.08));
    }
  }

  // No-op — bgFade() now reads state directly
  updateMix(_p: number): void {}

  verdictTone(): void {
    if (this.muted()) return;
    const a = new Audio('/verdict.mp3');
    a.volume = 0.95;
    a.play().catch(() => this.synthVerdictTone());
  }

  private synthVerdictTone(): void {
    const ac = this.getCtx();
    if (!ac) return;
    [110, 165, 220].forEach((freq, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ac.currentTime);
      g.gain.linearRampToValueAtTime(0.18, ac.currentTime + 0.1 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 3.0);
      o.start(ac.currentTime + i * 0.05);
      o.stop(ac.currentTime + 3.0);
    });
  }

  click(): void {
    this.preloadBg();
    if (this.muted()) return;
    const ac = this.getCtx();
    if (!ac) return;
    try {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.setValueAtTime(1400, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(700, ac.currentTime + 0.04);
      g.gain.setValueAtTime(0.22, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.07);
      o.start(); o.stop(ac.currentTime + 0.07);
    } catch {}
  }

  static(dur = 0.35): void {
    if (this.muted()) return;
    const ac = this.getCtx();
    if (!ac) return;
    try {
      const buf  = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.28;
      const src = ac.createBufferSource();
      const lpf = ac.createBiquadFilter();
      const g   = ac.createGain();
      lpf.type = 'bandpass'; lpf.frequency.value = 2400; lpf.Q.value = 0.5;
      src.buffer = buf;
      src.connect(lpf); lpf.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.9, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      src.start(); src.stop(ac.currentTime + dur);
    } catch {}
  }

  private geigerRate   = 0;
  private geigerHandle = 0;

  private scheduleGeiger(): void {
    if (!this.geigerRate) { this.geigerHandle = 0; return; }
    const delay = Math.max(40, 1000 / this.geigerRate);
    this.geigerHandle = window.setTimeout(() => {
      if (!this.muted()) this.geigerClick();
      this.scheduleGeiger();
    }, delay * (0.75 + Math.random() * 0.5));
  }

  private geigerClick(): void {
    const ac = this.getCtx();
    if (!ac) return;
    try {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.value = 3000 + Math.random() * 2000;
      g.gain.setValueAtTime(0.08, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.015);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.018);
    } catch {}
  }

  stopGeiger(): void {
    clearTimeout(this.geigerHandle);
    this.geigerHandle = 0;
    this.geigerRate   = 0;
  }

  toggle(): void { this.muted.update(m => !m); }

  stopAll(): void {
    clearInterval(this.fadeId);
    this.fadeId = 0;
    this.stopGeiger();
    for (const t of [this.amb, this.scr, this.dog, this.air]) {
      if (!t) continue;
      t.target    = 0;
      t.el.volume = 0;
      try { t.el.pause(); t.el.currentTime = 0; } catch {}
    }
    this.ambientStarted = false;
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

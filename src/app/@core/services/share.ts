import { Injectable, signal } from '@angular/core';
import { SimStats } from '../interfaces/simulation.model';

export interface SharePayload {
  v: number;
  c: string;
  ll: [number, number];
  s: number;
  vt: string;
  pz: string;
  t: number;
  sr: number;
  op: number;
  zm: number;
}

const SCHEMA_VERSION = 1;
const TINYURL_API = 'https://tinyurl.com/api-create.php';
const PARAM_KEY = 'outbreak';

@Injectable({ providedIn: 'root' })
export class ShareService {
  readonly shortUrl = signal<string | null>(null);
  readonly isShortening = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  async buildAndShorten(
    cityName: string,
    cityCenter: [number, number],
    seed: number,
    variant: string,
    patientZeroCell: string,
    stats: SimStats,
    tickCount: number,
  ): Promise<string> {
    this.isShortening.set(true);
    this.error.set(null);
    this.shortUrl.set(null);

    const payload: SharePayload = {
      v: SCHEMA_VERSION,
      c: cityName,
      ll: cityCenter,
      s: seed,
      vt: variant,
      pz: patientZeroCell,
      t: tickCount,
      sr: parseFloat(stats.survivalRate.toFixed(4)),
      op: parseFloat(stats.cityOverrunPct.toFixed(4)),
      zm: stats.totalZombie,
    };

    const encoded = this.encode(payload);
    const longUrl = this.buildLongUrl(encoded);

    try {
      const short = await this.shorten(longUrl);
      this.shortUrl.set(short);
      return short;
    } catch (e) {
      console.warn('[ShareService] TinyURL failed, using long URL', e);
      this.error.set('Could not shorten URL — sharing long link instead.');
      this.shortUrl.set(longUrl);
      return longUrl;
    } finally {
      this.isShortening.set(false);
    }
  }

  decodeFromUrl(): SharePayload | null {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get(PARAM_KEY);
      if (!encoded) return null;
      return this.decode(encoded);
    } catch {
      return null;
    }
  }

  clearUrlParam(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete(PARAM_KEY);
    window.history.replaceState({}, '', url.toString());
  }

  async copyToClipboard(url: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  }

  buildTwitterIntent(shortUrl: string, cityName: string, overrunPct: number): string {
    const pct = Math.round(overrunPct * 100);
    const text = `🧟 I just ran a zombie apocalypse on ${cityName} — ${pct}% of the city is overrun. Can your city survive? Try it: ${shortUrl} #ZombieOutbreak #Simulation`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  }

  buildWhatsAppShare(shortUrl: string, cityName: string, overrunPct: number): string {
    const pct = Math.round(overrunPct * 100);
    const text = `🧟 I just simulated a zombie apocalypse on ${cityName} — ${pct}% overrun. See if YOUR city survives: ${shortUrl}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  private encode(payload: SharePayload): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const binary = Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join('');
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private decode(encoded: string): SharePayload {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.split('').map((c) => c.charCodeAt(0)));
    const json = new TextDecoder().decode(bytes);
    const payload = JSON.parse(json) as SharePayload;
    if (payload.v !== SCHEMA_VERSION) {
      throw new Error(`Unsupported share schema version: ${payload.v}`);
    }
    return payload;
  }

  private buildLongUrl(encoded: string): string {
    const base = window.location.origin + window.location.pathname;
    return `${base}?${PARAM_KEY}=${encoded}`;
  }

  private async shorten(longUrl: string): Promise<string> {
    const apiUrl = `${TINYURL_API}?url=${encodeURIComponent(longUrl)}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`TinyURL HTTP ${res.status}`);
    const text = await res.text();
    if (!text.startsWith('https://tinyurl.com/')) throw new Error('Unexpected TinyURL response');
    return text.trim();
  }
}

import {
  ChangeDetectionStrategy, Component, inject,
  OnInit, OnDestroy, signal, computed,
} from '@angular/core';
import { Router } from '@angular/router';
import { AppState } from '../../../app.state';
import { AudioService } from '../../services/audio.service';
import { SurvivalService, SurvivalResult } from '../../services/survival.service';

function randRef(): string {
  return 'ZBM-' + new Date().getFullYear() + '-' +
    String(Math.floor(Math.random() * 90000) + 10000);
}

function bar(pct: number, len = 12): string {
  const filled = Math.round((pct / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

@Component({
  selector: 'app-verdict',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="verdict-root">
      <div class="noise"></div>
      <div class="scanlines"></div>

      <div class="card-wrap anim-fade-in">
        <!-- Header -->
        <div class="card-header">
          <span class="classified">DOCUMENT: CLASSIFIED — EYES ONLY</span>
          <span class="ref">INCIDENT REF: {{ ref }}</span>
        </div>

        <div class="card-divider"></div>

        <!-- Meta -->
        <div class="meta-grid">
          <div class="meta-row">
            <span class="ml">SUBJECT CITY</span>
            <span class="mv">{{ cityName() }}</span>
          </div>
          <div class="meta-row">
            <span class="ml">STRAIN</span>
            <span class="mv">G-002 / {{ variantLabel() }}</span>
          </div>
          <div class="meta-row">
            <span class="ml">DURATION</span>
            <span class="mv">{{ hoursLabel() }}</span>
          </div>
          <div class="meta-row">
            <span class="ml">CITY SURVIVORS</span>
            <span class="mv">{{ survivorBar() }}  {{ survPct() }}%</span>
          </div>
        </div>

        <div class="card-divider"></div>

        <!-- Verdict reveal -->
        @if (result()) {
          <div class="verdict-section">
            <div class="verdict-label">SUBJECT OUTCOME</div>
            <div class="verdict-word" [attr.data-outcome]="result()!.outcome">
              {{ result()!.headline }}
            </div>
            <div class="survival-pct">
              SURVIVAL PROBABILITY: <span>{{ result()!.probability }}%</span>
            </div>
            <div class="escape-detail">{{ result()!.escapeDetail }}</div>
            <div class="flavour">"{{ result()!.flavourText }}"</div>
          </div>
        }

        <div class="card-divider"></div>

        <!-- Actions -->
        <div class="actions">
          <button class="action-btn primary" (click)="share()">
            {{ showCopied() ? '✓ COPIED TO CLIPBOARD' : '[ SHARE ]' }}
          </button>
          <button class="action-btn" (click)="tryAgain()">[ TRY AGAIN ]</button>
        </div>

        <div class="card-footer">
          ⚠ UNAUTHORISED DISTRIBUTION PROHIBITED ⚠
        </div>
      </div>

      <!-- Hidden share canvas -->
      <canvas #shareCanvas style="display:none" width="700" height="440"></canvas>
    </div>
  `,
  styleUrl: './verdict.css',
})
export class VerdictComponent implements OnInit, OnDestroy {
  private router   = inject(Router);
  private state    = inject(AppState);
  private audio    = inject(AudioService);
  private survival = inject(SurvivalService);

  readonly result     = signal<SurvivalResult | null>(null);
  readonly showCopied = signal(false);
  readonly ref        = randRef();

  readonly cityName   = computed(() => this.state.selectedCityConfig()?.displayName ?? 'UNKNOWN');
  readonly variantLabel = computed(() => {
    const v = this.state.variant();
    return v === 'fast' ? 'RUNNER' : v === 'horde' ? 'HORDE' : 'STANDARD';
  });
  readonly hoursLabel = computed(() => {
    const h = this.state.hoursElapsed();
    return `${h}h ${Math.floor(Math.random() * 59)}m`;
  });
  readonly survPct  = computed(() =>
    Math.round(this.state.cityOverrunPct() === 0 ? 100 :
      (1 - this.state.cityOverrunPct()) * 100 * (0.85 + Math.random() * 0.15)));
  readonly survivorBar = computed(() => bar(this.survPct()));

  private toneTimer    = 0;
  private verdictAudio: HTMLAudioElement | null = null;

  ngOnInit(): void {
    const profile = this.state.userProfile();
    if (!profile) { this.router.navigate(['/select']); return; }

    const pzCell  = this.state.patientZeroCell();
    const userCell = this.state.userCell();
    const isPZ    = !!pzCell && !!userCell && pzCell === userCell;

    const res = this.survival.calculate(
      profile,
      isPZ,
      this.state.userInfectedTick(),
      this.state.userOverrunTick(),
      this.state.tick(),
      this.state.cityOverrunPct(),
    );

    this.audio.static(0.5);
    this.toneTimer = window.setTimeout(() => {
      this.result.set(res);
      // Track the verdict audio so tryAgain can stop it
      this.verdictAudio = new Audio('/verdict.mp3');
      this.verdictAudio.volume = 0.95;
      this.verdictAudio.play().catch(() => this.audio.verdictTone());
    }, 600);
  }

  share(): void {
    this.audio.click();
    this.shareCard();
  }

  private async shareCard(): Promise<void> {
    const res = this.result();
    if (!res) return;

    const canvas = this.buildCanvas(res);
    const shareText =
      `☣ ZOMBIE OUTBREAK REPORT ☣\n` +
      `City: ${this.cityName()} | Outcome: ${res.headline}\n` +
      `Survival probability: ${res.probability}%\n` +
      `"${res.flavourText}"\n` +
      `Can you do better? → zombiemap.io`;

    // Mobile: Web Share API with image
    if (typeof navigator.share === 'function') {
      try {
        const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'));
        const file = new File([blob], 'zombie-outbreak-report.png', { type: 'image/png' });
        const canShareFiles = navigator.canShare?.({ files: [file] });
        if (canShareFiles) {
          await navigator.share({ title: 'Zombie Outbreak Report', text: shareText, files: [file] });
          return;
        }
        // Share text + url without file
        await navigator.share({ title: 'Zombie Outbreak Report', text: shareText });
        return;
      } catch { /* user cancelled or not supported — fall through */ }
    }

    // Desktop fallback: copy text to clipboard + trigger image download
    try {
      await navigator.clipboard.writeText(shareText);
      this.showCopied.set(true);
      setTimeout(() => this.showCopied.set(false), 2500);
    } catch {}
    this.downloadCanvas(canvas);
  }

  private downloadCanvas(canvas: HTMLCanvasElement): void {
    const a    = document.createElement('a');
    a.download = `zombie-outbreak-${Date.now()}.png`;
    a.href     = canvas.toDataURL('image/png');
    a.click();
  }

  tryAgain(): void {
    // Stop verdict sting immediately
    if (this.verdictAudio) {
      this.verdictAudio.pause();
      this.verdictAudio.currentTime = 0;
      this.verdictAudio = null;
    }
    this.audio.static(0.2);
    this.state.resetSimState();
    this.audio.stopAll();
    this.router.navigate(['/select']);
  }

  private buildCanvas(res: SurvivalResult): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width  = 700;
    canvas.height = 440;
    const ctx    = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#050008';
    ctx.fillRect(0, 0, 700, 440);

    // Border
    ctx.strokeStyle = '#ff003c';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(12, 12, 676, 416);
    ctx.strokeStyle = 'rgba(255,0,60,.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(16, 16, 668, 408);

    // Corner decorations
    const corners: [number,number,number,number][] = [[12,12,1,1],[688,12,-1,1],[12,428,1,-1],[688,428,-1,-1]];
    ctx.strokeStyle = '#ff003c'; ctx.lineWidth = 2;
    corners.forEach(([x,y,dx,dy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + dy*20); ctx.lineTo(x,y); ctx.lineTo(x + dx*20, y); ctx.stroke();
    });

    const mono = '\'Share Tech Mono\', monospace';
    const title = '\'Bebas Neue\', sans-serif';

    // Header
    ctx.fillStyle = 'rgba(255,0,60,.55)';
    ctx.font = `10px ${mono}`;
    ctx.letterSpacing = '3px';
    ctx.fillText('DOCUMENT: CLASSIFIED — EYES ONLY', 32, 44);
    ctx.fillStyle = 'rgba(255,150,170,.4)';
    ctx.fillText(`INCIDENT REF: ${this.ref}`, 440, 44);

    // Divider
    ctx.strokeStyle = 'rgba(255,0,60,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(32, 56); ctx.lineTo(668, 56); ctx.stroke();

    // Meta section
    ctx.letterSpacing = '2px';
    const metaRows = [
      ['SUBJECT CITY', this.cityName()],
      ['STRAIN', `G-002 / ${this.variantLabel()}`],
      ['CITY SURVIVORS', `${this.survivorBar()}  ${this.survPct()}%`],
    ];
    metaRows.forEach(([label, val], i) => {
      ctx.fillStyle = 'rgba(255,0,60,.5)';
      ctx.font = `9px ${mono}`;
      ctx.fillText(label, 32, 84 + i * 22);
      ctx.fillStyle = 'rgba(255,220,230,.85)';
      ctx.font = `11px ${mono}`;
      ctx.fillText(val, 200, 84 + i * 22);
    });

    // Divider 2
    ctx.strokeStyle = 'rgba(255,0,60,.35)';
    ctx.beginPath(); ctx.moveTo(32, 160); ctx.lineTo(668, 160); ctx.stroke();

    // Verdict
    ctx.letterSpacing = '6px';
    ctx.fillStyle = 'rgba(255,0,60,.45)';
    ctx.font = `10px ${mono}`;
    ctx.fillText('SUBJECT OUTCOME', 32, 186);

    ctx.letterSpacing = '4px';
    ctx.fillStyle = '#fff';
    ctx.font = `bold 46px ${title}`;
    const outcomeColors: Record<string, string> = {
      survived_hero: '#00ff88', survived_lucky: '#88ff44',
      survived_barely: '#ffcc00', turned: '#b026ff',
      died_fighting: '#ff6600', patient_zero_irony: '#ff003c',
    };
    ctx.fillStyle = outcomeColors[res.outcome] ?? '#fff';
    ctx.fillText(res.headline, 32, 238);

    ctx.fillStyle = 'rgba(255,220,230,.5)';
    ctx.letterSpacing = '1px';
    ctx.font = `11px ${mono}`;
    ctx.fillText(`SURVIVAL PROBABILITY: ${res.probability}%`, 32, 262);

    // Flavour text (word-wrap)
    ctx.fillStyle = 'rgba(255,200,210,.6)';
    ctx.letterSpacing = '0px';
    ctx.font = `italic 12px ${mono}`;
    const words = `"${res.flavourText}"`.split(' ');
    let line = '', y = 296;
    words.forEach(w => {
      const test = line + w + ' ';
      if (ctx.measureText(test).width > 620 && line) {
        ctx.fillText(line, 32, y); line = w + ' '; y += 18;
      } else { line = test; }
    });
    ctx.fillText(line, 32, y);

    // Divider 3
    ctx.strokeStyle = 'rgba(255,0,60,.35)';
    ctx.beginPath(); ctx.moveTo(32, 384); ctx.lineTo(668, 384); ctx.stroke();

    // Footer
    ctx.fillStyle = 'rgba(255,0,60,.35)';
    ctx.letterSpacing = '2px';
    ctx.font = `9px ${mono}`;
    ctx.fillText('ZOMBIEMAP.IO', 32, 410);
    ctx.fillStyle = 'rgba(255,100,120,.25)';
    ctx.fillText('⚠ UNAUTHORISED DISTRIBUTION PROHIBITED ⚠', 200, 410);

    return canvas;
  }

  ngOnDestroy(): void {
    clearTimeout(this.toneTimer);
  }
}

import {
  ChangeDetectionStrategy, Component, inject,
  OnInit, OnDestroy, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { AudioService } from '../../services/audio.service';

@Component({
  selector: 'app-intro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="intro-root" (click)="proceed()" (keydown.enter)="proceed()" tabindex="0">

      <!-- Background noise texture -->
      <div class="noise"></div>

      <!-- Scanlines overlay -->
      <div class="scanlines"></div>

      <!-- Main content -->
      <div class="content">
        <div class="ebs-header anim-fade-in" style="animation-delay:.1s">
          ⚠&nbsp;&nbsp;EMERGENCY BROADCAST SYSTEM&nbsp;&nbsp;⚠
        </div>

        <div class="divider anim-fade-in" style="animation-delay:.5s"></div>

        <div class="not-a-test anim-fade-in" style="animation-delay:.9s">
          THIS IS NOT A TEST
        </div>

        <div class="outbreak-line anim-fade-in" style="animation-delay:1.6s">
          OUTBREAK CONFIRMED
        </div>

        <div class="sub-line anim-fade-in" style="animation-delay:2.2s">
          PATHOGEN G-002 · CLASS: RUNNER · MORTALITY RATE: UNKNOWN
        </div>

        <div class="divider anim-fade-in" style="animation-delay:2.6s"></div>

        <div class="select-city anim-fade-in" style="animation-delay:3.2s">
          SELECT YOUR CITY
        </div>

        @if (showPrompt()) {
          <div class="click-prompt">— CLICK ANYWHERE TO CONTINUE —</div>
        }
      </div>

      <!-- Glitch bar overlay -->
      <div class="glitch-overlay" aria-hidden="true"></div>
    </div>
  `,
  styleUrl: './intro.css',
})
export class IntroComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private audio  = inject(AudioService);

  readonly showPrompt = signal(false);
  private promptTimer = 0;

  ngOnInit(): void {
    this.audio.static(0.4);
    this.promptTimer = window.setTimeout(() => this.showPrompt.set(true), 3600);
  }

  proceed(): void {
    // Unlock all background tracks here — this is the first guaranteed user gesture
    this.audio.preloadBg();
    this.audio.static(0.25);
    this.router.navigate(['/select']);
  }

  ngOnDestroy(): void {
    clearTimeout(this.promptTimer);
  }
}

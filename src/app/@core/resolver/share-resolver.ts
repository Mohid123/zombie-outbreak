/**
 * shared-outbreak.resolver.ts
 *
 * Detects whether the app was opened via a shared outbreak URL (?outbreak=…),
 * decodes the payload, pre-seeds AppState with all simulation parameters, and
 * navigates directly to /sim — bypassing the intro/quiz flow.
 *
 * Register as a functional route resolver on the root '' route, OR call
 * checkAndReplay() from AppComponent.ngOnInit().
 *
 * Option A: Call from AppComponent
 *
 *   @Component({ selector: 'app-root', ... })
 *   export class AppComponent implements OnInit {
 *     private replay = inject(SharedOutbreakResolver);
 *     ngOnInit() { this.replay.checkAndReplay(); }
 *   }
 *
 * Option B: Angular functional resolver on the '' route
 *
 *   { path: '', component: IntroComponent, resolve: { replay: sharedOutbreakResolver } }
 *
 *   export const sharedOutbreakResolver: ResolveFn<void> = () =>
 *     inject(SharedOutbreakResolver).checkAndReplay();
 */

import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppState } from '../../app.state';
import { SharePayload, ShareService } from '../services/share';
import { CITY_CONFIGS } from '../interfaces/state.interface';

@Injectable({ providedIn: 'root' })
export class SharedOutbreakResolver {
  private shareService = inject(ShareService);
  private state = inject(AppState);
  private router = inject(Router);

  /**
   * Check URL for a shared outbreak param.
   * If found: pre-seed state and navigate to /sim.
   * If not:   do nothing.
   */
  checkAndReplay(): void {
    const payload = this.shareService.decodeFromUrl();
    if (!payload) return;

    // Remove the param so refreshing doesn't re-trigger
    this.shareService.clearUrlParam();

    try {
      this.applyPayloadToState(payload);
      // Navigate to sim — map-shell reads from state and boots immediately
      this.router.navigate(['/sim'], { replaceUrl: true });
    } catch (e) {
      console.warn('[SharedOutbreakResolver] Failed to apply shared payload', e);
      // Fall through to normal flow
    }
  }

  private applyPayloadToState(p: SharePayload): void {
    // Resolve the full CityConfig by displayName (p.c stores the displayName)
    const config = CITY_CONFIGS.find((c) => c.displayName === p.c) ?? null;
    if (!config) {
      throw new Error(`[SharedOutbreakResolver] Unknown city in share payload: "${p.c}"`);
    }

    this.state.setSelectedCityConfig(config);
    this.state.setCityCenter(p.ll);
    this.state.setSeed(p.s);
    this.state.setVariant(p.vt as any);
    this.state.setPatientZeroCell(p.pz);
    this.state.setIsReplay(true);

    console.info(
      `[SharedOutbreakResolver] Replaying shared outbreak — city: ${p.c}, ` +
        `seed: ${p.s}, variant: ${p.vt}, ticks: ${p.t}`,
    );
  }
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppState } from '../../../app.state';
import { AudioService } from '../../services/audio.service';
import { CITY_CONFIGS, CityConfig } from '../../interfaces/state.interface';

@Component({
  selector: 'app-city-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="select-root">
      <div class="noise"></div>
      <div class="scanlines"></div>

      <div class="content">
        <div class="header anim-fade-in">
          <div class="label">INCIDENT COMMAND — CITY SELECTION</div>
          <h1 class="title">SELECT INCIDENT LOCATION</h1>
          <p class="subtitle">Your city. Your outbreak. Your survival odds.</p>
        </div>

        <div class="grid anim-slide-up" style="animation-delay:.3s">
          @for (city of cities; track city.id) {
            <button class="city-card" (click)="select(city)">
              <div class="card-inner">
                <span class="flag">{{ city.flag }}</span>
                <div class="card-body">
                  <div class="city-name">{{ city.displayName }}</div>
                  <div class="city-country">{{ city.country }}</div>
                  <div class="city-desc">{{ city.description }}</div>
                  <div class="city-pop">
                    <span class="pop-label">POPULATION</span>
                    <span class="pop-val">{{ city.population }}</span>
                  </div>
                </div>
                <div class="card-glow"></div>
                <div class="card-corner tl"></div>
                <div class="card-corner tr"></div>
                <div class="card-corner bl"></div>
                <div class="card-corner br"></div>
              </div>
            </button>
          }
        </div>

        <div class="footer-note anim-fade-in" style="animation-delay:.6s">
          ⚠ All simulations are fictional. Population data approximate.
        </div>
      </div>
    </div>
  `,
  styleUrl: './city-select.css',
})
export class CitySelectComponent {
  private router = inject(Router);
  private state  = inject(AppState);
  private audio  = inject(AudioService);

  readonly cities = CITY_CONFIGS;

  select(city: CityConfig): void {
    this.audio.click();
    this.state.setSelectedCityConfig(city);
    this.audio.static(0.2);
    this.router.navigate(['/quiz']);
  }
}

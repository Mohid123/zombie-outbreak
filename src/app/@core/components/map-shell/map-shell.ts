import {
  ChangeDetectionStrategy, Component, inject,
  OnInit, OnDestroy, ChangeDetectorRef, signal, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { VerdictComponent } from '../verdict/verdict';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, take } from 'rxjs/operators';
import { MapService, RoadGraph } from '../../services/map';
import { cityCache } from '../city-select/city-select';
import { HttpClient } from '@angular/common/http';
import { SimCell } from '../../interfaces/simulation.model';
import { SimulationService } from '../../services/simulation';
import { AudioService } from '../../services/audio.service';
import { NarrativeService } from '../../services/narrative.service';
import { SurvivalService } from '../../services/survival.service';
import { AppState } from '../../../app.state';
import {
  TickSpeed, VariantType,
  tickSpeedConstant, variantType,
  SimPhase, EscapeStatus,
} from '../../interfaces/state.interface';
import * as h3 from 'h3-js';

interface CityJSON {
  cells:           SimCell[];
  center:          [number, number];
  totalPopulation: number;
  displayName:     string;
  roadGraph?:      RoadGraph;
  buildings?:      GeoJSON.Feature[];
  parks?:          GeoJSON.Feature[];
  water?:          GeoJSON.Feature[];
}

const SPEEDS: { label: string; ms: TickSpeed }[] = [
  { label: '1×',  ms: tickSpeedConstant['1x']  },
  { label: '2×',  ms: tickSpeedConstant['2x']  },
  { label: '5×',  ms: tickSpeedConstant['5x']  },
  { label: '10×', ms: tickSpeedConstant['10x'] },
];
const VARIANTS: { label: string; value: VariantType }[] = [
  { label: 'STANDARD', value: variantType.standard },
  { label: 'FAST',     value: variantType.fast     },
  { label: 'HORDE',    value: variantType.horde    },
];

const ESCAPE_LABELS: Record<EscapeStatus, string> = {
  open:    '🟢 ESCAPE WINDOW OPEN',
  flee:    '🟡 FLEE NOW',
  closing: '🔴 ESCAPE WINDOW CLOSING',
  closed:  '💀 ESCAPE WINDOW CLOSED',
  unknown: '⬜ LOCATING...',
};
const ESCAPE_CLASSES: Record<EscapeStatus, string> = {
  open: 'esc-open', flee: 'esc-flee', closing: 'esc-closing', closed: 'esc-closed', unknown: '',
};

@Component({
  selector: 'app-map-shell',
  imports: [CommonModule, VerdictComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="shell">
  <!-- MAP (always mounted, never re-created) -->
  <div id="map"></div>

  <!-- Vignette + scanlines -->
  <div class="vignette" aria-hidden="true"></div>
  <div class="scanlines-overlay" aria-hidden="true"></div>

  <!-- PHASE: placing user (FIRST) -->
  @if (simPhase() === 'placing-user') {
    <div class="overlay-instruction anim-fade-in">
      <div class="oi-label">STEP 1 OF 2</div>
      <div class="oi-title">WHERE DO YOU LIVE?</div>
      <div class="oi-sub">Pin your location — we'll track whether you can escape</div>
      <button class="oi-btn" (click)="randomiseUserLocation()">🎲 RANDOMISE MY LOCATION</button>
    </div>
  }

  <!-- PHASE: placing patient zero (SECOND) -->
  @if (simPhase() === 'placing-pz') {
    <div class="overlay-instruction anim-fade-in">
      <div class="oi-label">STEP 2 OF 2</div>
      <div class="oi-title">DROP GROUND ZERO</div>
      <div class="oi-sub">Choose where the outbreak begins — or let fate decide</div>
      <button class="oi-btn surprise" (click)="surpriseMe()">🎲 SURPRISE ME</button>
    </div>
  }

  <!-- PHASE: running -->
  @if (simPhase() === 'running') {

    <!-- Stats HUD -->
    <div class="hud stats-hud panel">
      <div class="hud-title">☣ OUTBREAK STATUS</div>
      <div class="stat-grid">
        <div class="stat-item">
          <span class="si-icon">💀</span>
          <span class="si-val">{{ state.totalDead() | number }}</span>
          <span class="si-lbl">DEAD</span>
        </div>
        <div class="stat-item">
          <span class="si-icon">🧟</span>
          <span class="si-val">{{ state.totalZombie() | number }}</span>
          <span class="si-lbl">TURNED</span>
        </div>
        <div class="stat-item">
          <span class="si-icon">✅</span>
          <span class="si-val">{{ state.totalSurvivors() | number }}</span>
          <span class="si-lbl">SURVIVORS</span>
        </div>
        <div class="stat-item">
          <span class="si-icon">⏱</span>
          <span class="si-val">{{ state.tick() }}</span>
          <span class="si-lbl">HOUR{{ state.tick() !== 1 ? 'S' : '' }}</span>
        </div>
      </div>
      <div class="overrun-bar">
        <div class="ob-label">CITY OVERRUN</div>
        <div class="ob-track">
          <div class="ob-fill" [style.width.%]="(state.cityOverrunPct() * 100)"></div>
        </div>
        <div class="ob-pct">{{ (state.cityOverrunPct() * 100) | number:'1.1-1' }}%</div>
      </div>
    </div>

    <!-- Escape window (only if user placed) -->
    @if (state.userCell()) {
      <div class="hud escape-hud panel" [class]="escapeClass()">
        <div class="esc-status">{{ escapeLabel() }}</div>
        @if (state.escapeStatus() === 'flee') {
          <div class="esc-urgency">Your neighbours are infected. Leave NOW.</div>
        }
        @if (state.escapeStatus() === 'closing') {
          <div class="esc-urgency">Infected detected in your cell. Limited time.</div>
        }
        @if (state.escapeStatus() === 'closed') {
          <div class="esc-urgency">Escape window has closed. You're surrounded.</div>
        }
      </div>
    }

    <!-- Legend -->
    <div class="hud legend-hud panel">
      <div class="hud-title">INFECTION MAP</div>
      @for (entry of legend; track entry.label) {
        <div class="legend-row">
          <span class="leg-swatch" [style.background]="entry.color"></span>
          <span class="leg-label">{{ entry.label }}</span>
        </div>
      }
    </div>

    <!-- Controls HUD -->
    <div class="hud controls-hud panel">
      <!-- Row 1 (desktop: inline) / Row 1 (mobile: top row) -->
      <div class="ctrl-row ctrl-row-primary">
        <button class="ctrl-btn pause-btn" (click)="togglePause()" [title]="state.isRunning() ? 'Pause' : 'Resume'">
          {{ state.isRunning() ? '⏸' : '▶' }}
        </button>
        <div class="ctrl-divider"></div>
        <div class="ctrl-group">
          <span class="ctrl-label">SPEED</span>
          <div class="btn-row">
            @for (s of speeds; track s.ms) {
              <button class="ctrl-btn" [class.active]="state.tickSpeed() === s.ms" (click)="setSpeed(s.ms)">
                {{ s.label }}
              </button>
            }
          </div>
        </div>
        <div class="ctrl-divider"></div>
        <button class="ctrl-btn mute-btn" (click)="toggleMute()" [title]="audio.muted() ? 'Unmute' : 'Mute'">
          {{ audio.muted() ? '🔇' : '🔊' }}
        </button>
      </div>

      <!-- Row 2 (desktop: inline after divider) / Row 2 (mobile: strain row) -->
      <div class="ctrl-divider ctrl-main-divider"></div>
      <div class="ctrl-row ctrl-row-strain">
        <div class="ctrl-group">
          <span class="ctrl-label">STRAIN</span>
          <div class="btn-row">
            @for (v of variants; track v.value) {
              <button class="ctrl-btn" [class.active]="state.variant() === v.value" (click)="setVariant(v.value)">
                {{ v.label }}
              </button>
            }
          </div>
        </div>
      </div>
    </div>

    <!-- News feed -->
    <div class="news-feed">
      @for (msg of narrative.messages(); track msg.id) {
        <div class="news-item" [class]="'ni-' + msg.category">
          <span class="ni-tick">[H+{{ msg.timestamp }}]</span>
          <span class="ni-text">{{ msg.text }}</span>
        </div>
      }
    </div>

  }

  <!-- WATER FAIL -->
  @if (waterFail()) {
    <div class="verdict-overlay anim-fade-in">
      <div class="water-fail-card panel">
        <div class="wf-icon">🌊</div>
        <div class="wf-headline">OUTBREAK CONTAINED</div>
        <div class="wf-sub">REASON: PATIENT ZERO CANNOT SWIM</div>
        <div class="wf-divider"></div>
        <p class="wf-body">
          You dropped Patient Zero into open water.<br>
          Turns out zombies sink. The outbreak lasted approximately<br>
          <strong>4 seconds</strong> before being resolved by the ocean.<br><br>
          CDC officials are calling it<br>"the most embarrassing pandemic attempt on record."
        </p>
        <div class="wf-divider"></div>
        <button class="oi-btn surprise" (click)="retryAfterWater()">
          🗺 &nbsp;TRY DRY LAND THIS TIME
        </button>
      </div>
    </div>
  }

  <!-- PHASE: verdict overlay -->
  @if (simPhase() === 'verdict') {
    <div class="verdict-overlay anim-fade-in">
      <app-verdict></app-verdict>
    </div>
  }

  <!-- Cell hover tooltip (raw DOM, outside CD) -->
  <div id="cell-tooltip" class="cell-tooltip" style="display:none"></div>
</div>
  `,
  styleUrl: './map-shell.css',
})
export class MapShell implements OnInit, OnDestroy {
  private mapService = inject(MapService);
  private simService = inject(SimulationService);
  private http       = inject(HttpClient);
  private router     = inject(Router);
  protected state    = inject(AppState);
  private cdr        = inject(ChangeDetectorRef);
  protected audio    = inject(AudioService);
  protected narrative = inject(NarrativeService);
  private survival   = inject(SurvivalService);

  private mapLoaded$ = toObservable(this.mapService.isLoaded);
  private cityData: CityJSON | null = null;
  private pendingVerdictAtTick = -1;
  readonly waterFail = signal(false);

  readonly speeds   = SPEEDS;
  readonly variants = VARIANTS;
  readonly legend   = [
    { color: '#cc0020', label: 'INFECTED — Early spread' },
    { color: '#8a0060', label: 'SPREADING — Growing' },
    { color: '#4a0080', label: 'OVERRUN — Critical' },
    { color: '#2a0040', label: 'ABANDONED — All lost' },
  ];

  readonly simPhase    = computed(() => this.state.simPhase());
  readonly escapeLabel = computed(() => ESCAPE_LABELS[this.state.escapeStatus()]);
  readonly escapeClass = computed(() => ESCAPE_CLASSES[this.state.escapeStatus()]);

  // Private tooltip element (raw DOM, no CD overhead)
  private tooltipEl: HTMLElement | null = null;

  ngOnInit(): void {
    const cityConfig = this.state.selectedCityConfig();
    if (!cityConfig) { this.router.navigate(['/select']); return; }

    this.narrative.init();
    this.mapService.init('map', cityConfig.center);

    this.mapLoaded$
      .pipe(filter(l => l), take(1))
      .subscribe(() => this.onMapReady());

    this.state.tickResult$.subscribe(result => {
      this.mapService.updateHexLayer(result.updatedCells);
      this.mapService.spawnTracers(result.spreadEvents);

      const tick  = this.state.tick();
      const dirty = result.updatedCells;

        // Update escape window
      this.updateEscapeWindow(dirty);

      // Drive audio mix from population spread (infected+zombie+dead / total)
      // cityOverrunPct only counts fully-overrun cells — too slow with new SIZD settings.
      // Population spread climbs as soon as infection touches anyone.
      const survivors  = this.state.totalSurvivors();
      const affected   = this.state.totalInfected() + this.state.totalZombie() + this.state.totalDead();
      const totalPop   = survivors + affected;
      const spreadPct  = totalPop > 0 ? affected / totalPop : 0;
      this.audio.updateMix(spreadPct);

      // Narrative messages — keyed to escape status, not raw cell status
      this.narrative.onTick(tick, result.spreadEvents.length, this.state.cityOverrunPct(), this.state.escapeStatus());

      this.cdr.markForCheck();

      // Personal verdict: fires 10 ticks after user's own cell is overrun
      if (this.pendingVerdictAtTick > 0 && tick >= this.pendingVerdictAtTick) {
        this.pendingVerdictAtTick = -1;
        this.enterVerdict();
        return;
      }
    });

    // City-wide end — only show verdict when appropriate for the user's position
    this.state.simEnded$.subscribe(() => {
      if (this.state.simPhase() === 'verdict') return;

      const esc = this.state.escapeStatus();

      if (esc === 'open' || esc === 'unknown') {
        // City fell but infection never reached the user — they escaped
        this.enterVerdict();
      } else if (this.pendingVerdictAtTick < 0) {
        // User was threatened (flee/closing/closed) but personal timer wasn't set
        // (e.g. cell infected but never quite overrun before sim ended)
        this.enterVerdict();
      }
      // If pendingVerdictAtTick is already scheduled, it fires on the next tick naturally
    });

    this.tooltipEl = document.getElementById('cell-tooltip');
  }

  private onMapReady(): void {
    const cfg = this.state.selectedCityConfig()!;

    // Use the pre-fetched observable from city-select if available,
    // otherwise fall back to a fresh HTTP request.
    const source = cityCache.get(cfg.id) ?? this.http.get<CityJSON>(cfg.jsonFile);

    source.subscribe((raw) => {
      const city = raw as CityJSON;
      this.cityData = city;
      this.mapService.renderGrid(city.cells);

      // Defer heavy non-critical work so the first paint is fast.
      // Road graph and city features are not needed until the sim starts.
      const idle = (typeof requestIdleCallback !== 'undefined')
        ? (fn: () => void) => requestIdleCallback(fn)
        : (fn: () => void) => setTimeout(fn, 80);

      idle(() => {
        if (city.roadGraph) this.mapService.initRoadGraph(city.roadGraph);
        // Skip parks — 20k polygons stall the GPU for no visual gain.
        // Water bodies and landmark buildings still render.
        if (city.buildings || city.water)
          this.mapService.loadCityFeatures(city.buildings ?? [], [], city.water ?? []);
      });

      // Wire map click for patient zero / user placement
      this.mapService.onMapClick(coord => this.handleMapClick(coord));

      // Wire hover tooltip
      this.mapService.onCellHover((props, screenXY) => this.updateTooltip(props, screenXY));

      this.cdr.markForCheck();
    });
  }

  private handleMapClick([lng, lat]: [number, number]): void {
    const phase = this.state.simPhase();
    // Step 1: user pins their own location first
    if (phase === 'placing-user') {
      this.audio.click();
      this.placeUser([lng, lat]);
    // Step 2: user drops ground zero
    } else if (phase === 'placing-pz') {
      this.audio.click();
      this.dropGroundZero([lng, lat]);
    }
  }

  // Called when user clicks map or presses Randomise in step 1
  randomiseUserLocation(): void {
    if (!this.cityData) return;
    this.audio.click();
    const candidates = this.cityData.cells.filter(c =>
      c.population > 200 && c.landUse !== 'water');
    const cell = candidates[Math.floor(Math.random() * candidates.length)] ?? this.cityData.cells[0];
    this.placeUser(cell.center);
  }

  private placeUser(coord: [number, number]): void {
    const [lng, lat] = coord;
    const cellId = h3.latLngToCell(lat, lng, 9);
    this.state.setUserCell(cellId);
    this.state.setUserCoord([lng, lat]);
    this.mapService.setUserMarker([lng, lat]);
    // Advance to ground-zero placement
    this.state.setSimPhase('placing-pz');
    this.cdr.markForCheck();
  }

  // Called when user clicks map or presses Surprise Me in step 2
  surpriseMe(): void {
    if (!this.cityData) return;
    this.audio.static(0.2);
    const candidates = this.cityData.cells.filter(c =>
      c.population > 1000 && (c.landUse === 'residential' || c.landUse === 'commercial'));
    const cell = candidates[Math.floor(Math.random() * candidates.length)] ?? this.cityData.cells[0];
    this.dropGroundZero(cell.center);
  }

  private dropGroundZero(coord: [number, number]): void {
    const [lng, lat] = coord;
    const cellId = h3.latLngToCell(lat, lng, 9);

    // Check if the cell is uninhabitable (water, park, zero population)
    const cell = this.cityData?.cells.find(c => c.cellId === cellId)
      ?? this.cityData?.cells.reduce((best, c) => {
        const d = (c.center[0]-lng)**2 + (c.center[1]-lat)**2;
        const bd = (best.center[0]-lng)**2 + (best.center[1]-lat)**2;
        return d < bd ? c : best;
      }, this.cityData.cells[0]);

    if (cell && (cell.population === 0 || cell.landUse === 'water')) {
      this.mapService.setPatientZeroMarker([lng, lat]);
      this.state.setSimPhase('running'); // needed so the overlay shows over the map
      this.waterFail.set(true);
      this.cdr.markForCheck();
      return;
    }

    this.state.setPatientZeroCell(cellId);
    this.state.setPatientZeroCoord([lng, lat]);
    this.mapService.setPatientZeroMarker([lng, lat]);
    this.mapService.focusOnPatientZero([lng, lat]);
    this.startSimulation();
  }

  private startSimulation(): void {
    if (!this.cityData) return;
    this.state.setSimPhase('running');
    this.state.setEscapeStatus('open');
    this.narrative.push(
      `⚠ OUTBREAK DETECTED — ${this.state.selectedCityConfig()!.displayName}. CONTAINMENT STATUS: FAILED.`,
      'event', 0,
    );
    this.audio.startAmbient();
    this.simService.init(this.cityData.cells, Date.now());
    this.simService.start();
    this.cdr.markForCheck();
  }

  private updateEscapeWindow(dirty: SimCell[]): void {
    const userCell = this.state.userCell();
    if (!userCell) return;

    const dirtyMap = new Map(dirty.map(c => [c.cellId, c]));

    // Check own cell
    const ownUpdated = dirtyMap.get(userCell);
    if (ownUpdated) {
      if (ownUpdated.status === 'overrun' && this.state.escapeStatus() !== 'closed') {
        this.state.setEscapeStatus('closed');
        this.state.setUserOverrunTick(this.state.tick());
        // Schedule verdict 10 ticks later — city keeps spreading, sound layers keep building
        if (this.pendingVerdictAtTick < 0)
          this.pendingVerdictAtTick = this.state.tick() + 10;
        return;
      }
      if (ownUpdated.status === 'infected' && this.state.userInfectedTick() === -1) {
        this.state.setEscapeStatus('closing');
        this.state.setUserInfectedTick(this.state.tick());
        return;
      }
    }

    if (this.state.escapeStatus() === 'closed' || this.state.escapeStatus() === 'closing') return;

    // Check ring-1 neighbours
    const neighbours = h3.gridDisk(userCell, 1).filter(id => id !== userCell);
    const anyNeighbourInfected = neighbours.some(nid => {
      const nc = dirtyMap.get(nid) ?? this.state.grid.get(nid);
      return nc && nc.status !== 'clean';
    });
    if (anyNeighbourInfected) {
      this.state.setEscapeStatus('flee');
    }
  }

  retryAfterWater(): void {
    this.audio.click();
    this.waterFail.set(false);
    this.mapService.resetSimLayers();
    this.state.resetSimState();
    this.state.setSimPhase('placing-user');
    this.cdr.markForCheck();
  }

  private enterVerdict(): void {
    if (this.state.simPhase() === 'verdict') return;
    this.audio.stopAll();
    this.audio.static(0.6);
    this.state.setSimPhase('verdict');
    this.cdr.markForCheck();
  }

  // Tooltip (raw DOM — never touches Angular CD)
  private updateTooltip(
    props: Record<string, unknown> | null,
    screenXY: [number, number] | null,
  ): void {
    if (!this.tooltipEl) return;
    if (!props || !screenXY) { this.tooltipEl.style.display = 'none'; return; }

    const ratio  = (props['zombieRatio'] as number ?? 0);
    const status = (props['status'] as string ?? 'clean');
    const pct    = (ratio * 100).toFixed(1);

    this.tooltipEl.innerHTML =
      `<div class="tt-status tt-${status}">${status.toUpperCase()}</div>` +
      `<div class="tt-row"><span>Zombie ratio </span><span>${pct}%</span></div>`;

    const el = this.tooltipEl;
    el.style.display = 'block';
    el.style.left    = `${screenXY[0] + 14}px`;
    el.style.top     = `${screenXY[1] - 10}px`;
  }

  // Controls
  setSpeed(ms: TickSpeed): void {
    this.audio.click();
    this.simService.setSpeed(ms);
    this.cdr.markForCheck();
  }

  setVariant(v: VariantType): void {
    if (this.state.variant() === v) return;
    this.audio.click();
    this.state.setVariant(v);
    this.restartSim();
    this.cdr.markForCheck();
  }

  togglePause(): void {
    this.audio.click();
    if (this.state.isRunning()) { this.simService.pause(); }
    else if (this.state.status() === 'paused') { this.simService.resume(); }
    this.cdr.markForCheck();
  }

  toggleMute(): void {
    this.audio.toggle();
    this.cdr.markForCheck();
  }

  private restartSim(): void {
    if (!this.cityData) return;

    // Save placement before reset — resetSimState() clears these signals
    const pzCell   = this.state.patientZeroCell();
    const pzCoord  = this.state.patientZeroCoord();
    const userCell = this.state.userCell();
    const userCoord = this.state.userCoord();

    this.simService.reset();
    this.mapService.resetSimLayers();
    this.narrative.init();
    this.pendingVerdictAtTick = -1;
    this.waterFail.set(false);

    // Restore placement so the worker seeds the same patient-zero cell
    if (pzCell)   this.state.setPatientZeroCell(pzCell);
    if (pzCoord)  this.state.setPatientZeroCoord(pzCoord);
    if (userCell) this.state.setUserCell(userCell);
    if (userCoord) this.state.setUserCoord(userCoord);

    this.startSimulation();
  }

  ngOnDestroy(): void {
    this.mapService.removeClickHandler();
    this.mapService.removeHoverHandler();
    this.mapService.destroy();
    this.audio.stopAll();
  }
}

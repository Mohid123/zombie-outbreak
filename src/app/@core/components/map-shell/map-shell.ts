import { ChangeDetectionStrategy, Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, take } from 'rxjs/operators';
import { MapService } from '../../services/map';
import { HttpClient } from '@angular/common/http';
import { SimCell } from '../../interfaces/simulation.model';
import { SimulationService } from '../../services/simulation';
import { AppState } from '../../../app.state';

interface CityJSON {
  cells: SimCell[];
  center: [number, number];
  totalPopulation: number;
  displayName: string;
}

@Component({
  selector: 'app-map-shell',
  imports: [],
  template: `
    <div class="map-container">
      <div id="map"></div>
      <div class="test-overlay">
        <div class="stat">💀 {{ state.totalDead() }}</div>
        <div class="stat">🧟 {{ state.totalZombie() }}</div>
        <div class="stat">✅ {{ state.totalSurvivors() }}</div>
        <div class="stat">⏱ Tick {{ state.tick() }}</div>
        <div class="stat">Status: {{ state.status() }}</div>
      </div>
    </div>
  `,
  styleUrl: './map-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapShell implements OnInit, OnDestroy {
  private mapService = inject(MapService);
  private simService = inject(SimulationService);
  private http = inject(HttpClient);
  protected state = inject(AppState);

  // toObservable is called at field initializer level — injection contex
  private mapLoaded$ = toObservable(this.mapService.isLoaded);
  private cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.mapService.init('map');

    this.mapLoaded$
      .pipe(
        filter((loaded) => loaded),
        take(1),
      )
      .subscribe(() => this.runTestSimulation());

    this.state.tickResult$.subscribe((result) => {
      this.mapService.updateHexLayer(result.updatedCells);
      this.cdr.markForCheck(); // tells OnPush to re-evaluate signals
      console.log('Tick:', this.state.tick(), '| Dead:', this.state.totalDead());
    });
  }

  private runTestSimulation(): void {
    this.http.get<CityJSON>('/lahore.json').subscribe((city) => {
      console.log(`Loaded ${city.displayName} — ${city.cells.length} cells`);
      console.log(`Total population: ${city.totalPopulation.toLocaleString()}`);

      this.mapService.renderGrid(city.cells);

      const centreCell = this.findCentreCell(city.cells);
      console.log('Patient Zero cell:', centreCell);
      this.state.setPatientZeroCell(centreCell);

      this.simService.init(city.cells, 42);
      this.simService.start();
    });
  }

  private findCentreCell(cells: SimCell[]): string {
    const targetLng = 74.3587;
    const targetLat = 31.5204;

    let closest = cells[0];
    let minDist = Infinity;

    cells.forEach((cell) => {
      const [lng, lat] = cell.center;
      const dist = Math.sqrt(Math.pow(lng - targetLng, 2) + Math.pow(lat - targetLat, 2));
      if (dist < minDist) {
        minDist = dist;
        closest = cell;
      }
    });

    return closest.cellId;
  }

  ngOnDestroy(): void {
    this.mapService.destroy();
  }
}

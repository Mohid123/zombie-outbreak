import { Injectable, signal } from '@angular/core';
import maplibregl, { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { environment } from '../../../environments/environment';
import { SimCell } from '../interfaces/simulation.model';
import * as h3 from 'h3-js';

@Injectable({ providedIn: 'root' })
export class MapService {
  private map!: MapLibreMap;
  readonly isLoaded = signal<boolean>(false);

  // Track rendered cells locally
  private renderedFeatures = new globalThis.Map<string, GeoJSON.Feature>();

  init(containerId: string): void {
    this.map = new maplibregl.Map({
      container: containerId,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${environment.mapTilerKey}`,
      center: [74.3587, 31.5204],
      zoom: 11,
      pitch: 45,
      bearing: 0,
    });

    this.map.on('load', () => {
      this.isLoaded.set(true);
      this.addLayers();
    });
  }

  private addLayers(): void {
    //Source — starts empty
    this.map.addSource('hex-grid', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Layer 1 — base fill
    this.map.addLayer({
      id: 'hex-fill',
      type: 'fill',
      source: 'hex-grid',
      paint: {
        'fill-color': [
          'match', ['get', 'status'],
          'infected',  '#8B0000',
          'overrun',   '#1a0505',
          'abandoned', '#0a0a0a',
          '#0f1428'
        ],
        'fill-opacity': [
          'match', ['get', 'status'],
          'infected',  0.82,
          'overrun',   0.95,
          'abandoned', 0.6,
          0.3
        ],
      },
    });

    //Layer 2 — plasma glow border on infected frontier
    this.map.addLayer({
      id: 'hex-glow',
      type: 'line',
      source: 'hex-grid',
      filter: ['==', ['get', 'status'], 'infected'],
      paint: {
        'line-color': '#e63946',
        'line-width': 2.5,
        'line-blur': 3,
        'line-opacity': 0.9,
      },
    });

    // ── Layer 3 — subtle border on all cells
    this.map.addLayer({
      id: 'hex-border',
      type: 'line',
      source: 'hex-grid',
      paint: {
        'line-color': [
          'match', ['get', 'status'],
          'infected',  '#c02020',
          'overrun',   '#3d0a0a',
          '#1a1f35'
        ],
        'line-width': 0.3,
        'line-opacity': 0.5,
      },
    });
  }

  //Called once on init — only renders the patient zero cell
  // Do NOT render all cells at once — let them appear as infected
  renderGrid(cells: SimCell[]): void {
    if (!this.map || !this.isLoaded()) return;

    // Store all cells locally for reference but don't render clean ones
    // Only pre-render cells that are already infected (patient zero)
    const infectedAtStart = cells.filter(c => c.status !== 'clean');

    if (infectedAtStart.length > 0) {
      infectedAtStart.forEach(cell => {
        this.renderedFeatures.set(cell.cellId, this.cellToFeature(cell));
      });
      this.flushToMap();
    }
  }

  //Called every tick with only the cells that changed
  updateHexLayer(dirtyCells: SimCell[]): void {
    if (!this.map || !this.isLoaded()) return;
    if (dirtyCells.length === 0) return;

    // Add or update each dirty cell
    dirtyCells.forEach(cell => {
      this.renderedFeatures.set(cell.cellId, this.cellToFeature(cell));
    });

    this.flushToMap();
  }

  //Push current rendered features to MapLibre source
  private flushToMap(): void {
    const source = this.map.getSource('hex-grid') as GeoJSONSource;
    if (!source) return;

    source.setData({
      type: 'FeatureCollection',
      features: Array.from(this.renderedFeatures.values()),
    });
  }

  private cellToFeature(cell: SimCell): GeoJSON.Feature {
    const boundary = h3.cellToBoundary(cell.cellId);
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          ...boundary.map(([lat, lng]) => [lng, lat]),
          [boundary[0][1], boundary[0][0]],
        ]],
      },
      properties: {
        cellId:      cell.cellId,
        status:      cell.status,
        population:  cell.population,
        infected:    cell.infected,
        zombie:      cell.zombie,
        dead:        cell.dead,
        zombieRatio: cell.population > 0 ? cell.zombie / cell.population : 0,
      },
    };
  }

  getMap(): MapLibreMap { return this.map; }

  flyTo(center: [number, number], zoom: number): void {
    this.map.flyTo({ center, zoom, pitch: 45, duration: 1800 });
  }

  destroy(): void {
    this.renderedFeatures.clear();
    this.map?.remove();
    this.isLoaded.set(false);
  }
}

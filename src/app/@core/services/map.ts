import { Injectable, signal } from '@angular/core';
import maplibregl, { Map, StyleSpecification } from 'maplibre-gl';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class MapService {
  private map!: Map;
  readonly isLoaded = signal<boolean>(false);

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
    });
  }

  getMap(): Map {
    return this.map;
  }

  flyTo(center: [number, number], zoom: number): void {
    this.map.flyTo({
      center,
      zoom,
      pitch: 45,
      duration: 1800,
    });
  }

  destroy(): void {
    this.map?.remove();
    this.isLoaded.set(false);
  }
}

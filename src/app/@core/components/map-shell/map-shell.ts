import { ChangeDetectionStrategy, Component, inject, OnInit, OnDestroy } from '@angular/core';
import { MapService } from '../../services/map';

@Component({
  selector: 'app-map-shell',
  imports: [],
  template: ` <div class="map-container">
    <div id="map"></div>
  </div>`,
  styleUrl: './map-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapShell implements OnInit, OnDestroy {
  private mapService = inject(MapService);

  ngOnInit(): void {
    this.mapService.init('map');
  }

  ngOnDestroy(): void {
    this.mapService.destroy();
  }
}

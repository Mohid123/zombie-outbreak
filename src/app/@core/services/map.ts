import { Injectable, signal } from '@angular/core';
import maplibregl, { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { environment } from '../../../environments/environment';
import { SimCell, SpreadEvent } from '../interfaces/simulation.model';
import * as h3 from 'h3-js';

const TRACER_TTL_MS     = 750;
const MAX_COMPLETED_LINES = 120; // hard cap on persistent spread-line history
const MAX_ROUTE_M       = 2000;
const RING_TTL_MS       = 1400;
const MAX_RINGS_PER_TICK = 10;
const BUILDING_RES      = 9;

// Road graph (loaded from preprocessed city JSON)
export interface RoadGraph {
  nodes: [number, number][];
  edges: Array<{ from: number; to: number; dist: number; road: string; coords: [number, number][] }>;
}
interface RoadEdge { to: number; dist: number; coords: [number, number][] }

// Tracer
interface Tracer {
  from:       [number, number];
  to:         [number, number];
  startTime:  number;
  jitter:     number;
  routedPath: [number, number][] | null;
}

// Ring ping
interface RingPing {
  center:    [number, number];
  startTime: number;
  isOverrun: boolean;
}

// Minimal binary min-heap
class MinHeap {
  private d: { id: number; f: number }[] = [];
  get size() { return this.d.length; }
  push(x: { id: number; f: number }) {
    this.d.push(x);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p].f <= this.d[i].f) break;
      [this.d[i], this.d[p]] = [this.d[p], this.d[i]]; i = p;
    }
  }
  pop(): { id: number; f: number } | undefined {
    const top = this.d[0]; const last = this.d.pop()!;
    if (this.d.length) {
      this.d[0] = last; let i = 0; const n = this.d.length;
      while (true) {
        let s = i; const l = 2*i+1, r = 2*i+2;
        if (l < n && this.d[l].f < this.d[s].f) s = l;
        if (r < n && this.d[r].f < this.d[s].f) s = r;
        if (s === i) break;
        [this.d[i], this.d[s]] = [this.d[s], this.d[i]]; i = s;
      }
    }
    return top;
  }
}

@Injectable({ providedIn: 'root' })
export class MapService {
  private map!: MapLibreMap;
  readonly isLoaded = signal<boolean>(false);

  // Hex grid
  private hexFeatures = new globalThis.Map<string, GeoJSON.Feature>();

  // Road routing
  private roadNodes: [number, number][] = [];
  private roadAdj   = new Map<number, RoadEdge[]>();
  private nodeGrid  = new Map<string, number[]>();
  private readonly GRID = 0.003;

  // Tracers
  private tracers:        Tracer[]          = [];
  private completedLines: GeoJSON.Feature[] = [];
  private completedDirty  = false;
  private rafHandle = 0;

  // Ring pings
  private ringPings: RingPing[] = [];

  // RAF frame counter (throttle non-critical work)
  private frameCount = 0;

  // Building reveal
  private buildingFeatures:  GeoJSON.Feature[] = [];
  private buildingCellIndex  = new Map<string, number[]>();

  // Layer insertion point
  private beforeRoadsId: string | undefined;

  // Markers
  private pzMarker:   maplibregl.Marker | null = null;
  private userMarker: maplibregl.Marker | null = null;

  // Event handlers
  private clickHandler:  ((coord: [number,number]) => void) | null = null;
  private hoverHandler:  ((props: Record<string,unknown>|null, xy:[number,number]|null) => void) | null = null;
  private boundMapClick: ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private boundMapMove:  ((e: maplibregl.MapMouseEvent) => void) | null = null;
  private boundMapLeave: (() => void) | null = null;
  private hoveredCellId: string | null = null;

  // Init

  init(containerId: string, center: [number, number] = [-74.006, 40.7128]): void {
    const isMobile = window.innerWidth < 768 ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    this.map = new maplibregl.Map({
      container: containerId,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${environment.mapTilerKey}`,
      center,
      zoom:             isMobile ? 11 : 12,
      pitch:            isMobile ? 0  : 35,
      bearing:          -10,
      fadeDuration:     0,              // skip tile fade-in flash on load
      renderWorldCopies: false,         // only render one world copy
      maxTileCacheSize:  isMobile ? 20 : 60,
      touchPitch:        false,         // two-finger pitch is jarring on mobile
      dragRotate:        true,          // right-click drag rotates bearing
      pixelRatio:        window.devicePixelRatio || 1,
    });

    this.map.on('load', () => {
      this.beforeRoadsId = this.findRoadLayer();
      this.addLayers();
      this.isLoaded.set(true);
      this.startAnimationLoop();
      // Compass + pitch indicator — right-click drag to rotate, click to reset north
      if (!isMobile) {
        this.map.addControl(
          new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true }),
          'bottom-right',
        );
      }
    });
  }

  initRoadGraph(graph: RoadGraph): void {
    this.roadNodes = graph.nodes;
    this.roadAdj.clear();
    this.nodeGrid.clear();

    for (const e of graph.edges) {
      if (!this.roadAdj.has(e.from)) this.roadAdj.set(e.from, []);
      this.roadAdj.get(e.from)!.push({ to: e.to, dist: e.dist, coords: e.coords });
    }

    graph.nodes.forEach(([lng, lat], id) => {
      const k = gk(lng, lat, this.GRID);
      if (!this.nodeGrid.has(k)) this.nodeGrid.set(k, []);
      this.nodeGrid.get(k)!.push(id);
    });

    console.log(`Road graph: ${graph.nodes.length} nodes, ${graph.edges.length} directed edges`);
  }

  // City features (buildings / parks / water)

  loadCityFeatures(
    buildings: GeoJSON.Feature[],
    parks:     GeoJSON.Feature[],
    water:     GeoJSON.Feature[],
  ): void {
    if (!this.map || !this.isLoaded()) return;

    // Water (below hex, pure atmosphere)
    this.map.addSource('city-water', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: water },
    });
    this.map.addLayer({
      id:     'city-water-fill',
      type:   'fill',
      source: 'city-water',
      paint:  { 'fill-color': '#030810', 'fill-opacity': 0.92 },
    }, this.beforeRoadsId);

    // Parks (below hex, dead / scorched)
    this.map.addSource('city-parks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: parks },
    });
    this.map.addLayer({
      id:     'city-parks-fill',
      type:   'fill',
      source: 'city-parks',
      paint:  { 'fill-color': '#050a05', 'fill-opacity': 0.82 },
    }, this.beforeRoadsId);

    // Buildings — 3-D reveal on infection
    // Keep original features as-is; revealStatus lives in feature state, not properties.
    // generateId:true makes MapLibre assign integer IDs matching array index — lets us
    // call setFeatureState(id=idx) instead of re-uploading the entire dataset on each tick.
    this.buildingFeatures = buildings;

    this.buildingCellIndex.clear();
    this.buildingFeatures.forEach((f, idx) => {
      const coords = (f.geometry as GeoJSON.Polygon).coordinates[0];
      if (!coords?.length) return;
      let sumLng = 0, sumLat = 0;
      coords.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
      const avgLng = sumLng / coords.length;
      const avgLat = sumLat / coords.length;
      const cellId = h3.latLngToCell(avgLat, avgLng, BUILDING_RES);
      if (!this.buildingCellIndex.has(cellId)) this.buildingCellIndex.set(cellId, []);
      this.buildingCellIndex.get(cellId)!.push(idx);
    });

    this.map.addSource('city-buildings', {
      type: 'geojson',
      generateId: true,
      data: { type: 'FeatureCollection', features: this.buildingFeatures },
    });

    this.map.addLayer({
      id:     'buildings-reveal',
      type:   'fill-extrusion',
      source: 'city-buildings',
      paint:  {
        'fill-extrusion-color': [
          'match', ['coalesce', ['feature-state', 'revealStatus'], 'clean'],
          'overrun',  '#8800cc',
          'infected', '#cc0020',
          '#0a0010',
        ],
        'fill-extrusion-height': [
          'match', ['coalesce', ['feature-state', 'revealStatus'], 'clean'],
          'overrun',  90,
          'infected', 45,
          3,
        ],
        'fill-extrusion-base':    0,
        'fill-extrusion-opacity': [
          'match', ['coalesce', ['feature-state', 'revealStatus'], 'clean'],
          'overrun',  0.95,
          'infected', 0.80,
          0.12,
        ],
        'fill-extrusion-color-transition':   { duration: 900, delay: 0 },
        'fill-extrusion-height-transition':  { duration: 1100, delay: 0 },
        'fill-extrusion-opacity-transition': { duration: 900, delay: 0 },
      },
    });

    console.log(
      `City features loaded — buildings: ${buildings.length}, ` +
      `parks: ${parks.length}, water: ${water.length}`,
    );
  }

  // Public simulation hooks

  focusOnPatientZero(center: [number, number]): void {
    this.map.flyTo({
      center,
      zoom:     16,
      pitch:    65,
      bearing:  -20,
      duration: 3000,
      essential: true,
    });
  }

  renderGrid(cells: SimCell[]): void {
    if (!this.map || !this.isLoaded()) return;
    const preInfected = cells.filter((c) => c.status !== 'clean');
    if (preInfected.length === 0) return;
    preInfected.forEach((c) => this.hexFeatures.set(c.cellId, cellToPolygon(c)));
    this.flushHex();
  }

  updateHexLayer(dirtyCells: SimCell[]): void {
    if (!this.map || !this.isLoaded()) return;
    if (dirtyCells.length === 0) return;

    dirtyCells.forEach((cell) => {
      if (cell.status === 'clean') { this.hexFeatures.delete(cell.cellId); return; }
      this.hexFeatures.set(cell.cellId, cellToPolygon(cell));
    });
    this.flushHex();

    // Building reveal — per-feature state updates instead of full setData re-upload.
    // Each changed building gets a targeted setFeatureState call (O(changed) not O(total)).
    if (this.buildingFeatures.length > 0) {
      dirtyCells.forEach((cell) => {
        const indices = this.buildingCellIndex.get(cell.cellId);
        if (!indices) return;
        const next =
          cell.status === 'overrun'  ? 'overrun'  :
          cell.status === 'infected' ? 'infected' : 'clean';
        indices.forEach((idx) => {
          this.map.setFeatureState(
            { source: 'city-buildings', id: idx },
            { revealStatus: next },
          );
        });
      });
    }
  }

  private flushHex(): void {
    (this.map.getSource('hex-grid') as GeoJSONSource | undefined)
      ?.setData({ type: 'FeatureCollection', features: [...this.hexFeatures.values()] });
  }

  spawnTracers(events: SpreadEvent[]): void {
    if (!events.length) return;
    // Cap per-tick spawns — at high infection rates hundreds of events fire per tick
    // and each becomes a LineString uploaded every frame
    const batch = events.length > 12 ? events.slice(0, 12) : events;
    const now   = performance.now();
    for (const e of batch) {
      const dx  = e.toCenter[0] - e.fromCenter[0];
      const dy  = e.toCenter[1] - e.fromCenter[1];
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const jitter = (Math.random() - 0.5) * 0.00012 * (len / 0.002);
      this.tracers.push({
        from: e.fromCenter,
        to:   e.toCenter,
        startTime: now,
        jitter,
        routedPath: this.routeAlongRoads(e.fromCenter, e.toCenter),
      });
    }
  }

  spawnRingPings(events: SpreadEvent[], isOverrun = false): void {
    if (!events.length) return;
    const now = performance.now();
    // Spawn a ping at the source of each spread event (origin flash)
    const batch = events.slice(0, MAX_RINGS_PER_TICK);
    batch.forEach((e) => {
      this.ringPings.push({ center: e.fromCenter, startTime: now,        isOverrun });
      this.ringPings.push({ center: e.toCenter,   startTime: now + 180,  isOverrun });
    });
  }

  fitToInfected(cells: SimCell[]): void {
    const active = cells.filter((c) => c.status === 'infected' || c.status === 'overrun');
    if (active.length < 4) return;

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    active.forEach(({ center: [lng, lat] }) => {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    });

    const lp  = Math.max((maxLng - minLng) * 0.15, 0.005);
    const ltp = Math.max((maxLat - minLat) * 0.15, 0.005);

    this.map.fitBounds(
      [[minLng - lp, minLat - ltp], [maxLng + lp, maxLat + ltp]],
      {
        duration: 3500,
        pitch:    50,
        bearing:  -15,
        maxZoom:  15,
        minZoom:  12,
        padding:  { top: 80, bottom: 80, left: 80, right: 80 },
      },
    );
  }

  // Layers

  private addLayers(): void {
    const beforeRoads = this.beforeRoadsId;

    // 1. Hex infection tint
    this.map.addSource('hex-grid', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id:     'hex-fill',
      type:   'fill',
      source: 'hex-grid',
      paint:  {
        'fill-color': [
          'interpolate', ['linear'], ['get', 'zombieRatio'],
          0.0, '#cc0020',
          0.35, '#8a0060',
          0.7,  '#4a0080',
          1.0,  '#2a0040',
        ],
        'fill-opacity': [
          'interpolate', ['linear'], ['get', 'zombieRatio'],
          0.0, 0.55,
          1.0, 0.75,
        ],
        'fill-opacity-transition': { duration: 700 },
        'fill-color-transition':   { duration: 700 },
      },
    }, beforeRoads);

    this.map.addLayer({
      id:     'hex-frontier',
      type:   'line',
      source: 'hex-grid',
      filter: ['==', ['get', 'status'], 'infected'],
      paint:  {
        'line-color':   '#ff003c',
        'line-width':   1.5,
        'line-blur':    2,
        'line-opacity': 0.85,
      },
    }, beforeRoads);

    // 2. Permanent spread-line network
    this.map.addSource('spread-lines', {
      type: 'geojson',
      lineMetrics: true,
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id:     'spread-glow',
      type:   'line',
      source: 'spread-lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  {
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0,    'rgba(220,0,40,0)',
          0.08, 'rgba(220,0,40,0.4)',
          0.7,  'rgba(150,20,220,0.5)',
          1,    'rgba(100,10,180,0.45)',
        ],
        'line-width': 7,
        'line-blur':  3.5,
      },
    });

    this.map.addLayer({
      id:     'spread-core',
      type:   'line',
      source: 'spread-lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  {
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0,    'rgba(255,0,60,0)',
          0.07, 'rgba(255,0,60,0.9)',
          0.65, 'rgba(160,30,240,0.9)',
          1,    'rgba(110,10,190,0.7)',
        ],
        'line-width': 1.8,
        'line-blur':  0.3,
      },
    });

    // 3. Active tracer animation
    this.map.addSource('tracer-tails', {
      type: 'geojson',
      lineMetrics: true,
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id:     'tracer-tail-glow',
      type:   'line',
      source: 'tracer-tails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  {
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0,   'rgba(255,0,60,0)',
          0.2, 'rgba(255,0,60,0.65)',
          1,   'rgba(180,40,255,0.9)',
        ],
        'line-width':   10,
        'line-blur':    3,
        'line-opacity': 0.5,
      },
    });

    this.map.addLayer({
      id:     'tracer-tail-core',
      type:   'line',
      source: 'tracer-tails',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint:  {
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0,    'rgba(255,0,60,0)',
          0.1,  'rgba(255,20,60,1)',
          1,    'rgba(195,55,255,1)',
        ],
        'line-width': 2.5,
        'line-blur':  0.2,
      },
    });

    this.map.addSource('tracers', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id:     'tracer-head-glow',
      type:   'circle',
      source: 'tracers',
      paint:  {
        'circle-radius':  ['*', ['get', 'radius'], 3.2],
        'circle-color':   ['get', 'color'],
        'circle-blur':    1.2,
        'circle-opacity': ['*', ['get', 'opacity'], 0.32],
      },
    });

    this.map.addLayer({
      id:     'tracer-head-core',
      type:   'circle',
      source: 'tracers',
      paint:  {
        'circle-radius':  ['get', 'radius'],
        'circle-color':   ['get', 'color'],
        'circle-blur':    0.15,
        'circle-opacity': ['get', 'opacity'],
      },
    });

    // 4. Ring pings (sonar wavefront)
    this.map.addSource('ring-pings', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Outer bloom
    this.map.addLayer({
      id:     'ring-bloom',
      type:   'circle',
      source: 'ring-pings',
      paint:  {
        'circle-radius':  ['get', 'r'],
        'circle-color':   ['get', 'c'],
        'circle-blur':    1.6,
        'circle-opacity': ['get', 'bo'],
        'circle-stroke-width': 0,
      },
    });

    // Sharp expanding ring edge
    this.map.addLayer({
      id:     'ring-edge',
      type:   'circle',
      source: 'ring-pings',
      paint:  {
        'circle-radius':         ['get', 'r'],
        'circle-color':          'rgba(0,0,0,0)',
        'circle-opacity':        0,
        'circle-stroke-width':   1.5,
        'circle-stroke-color':   ['get', 'c'],
        'circle-stroke-opacity': ['get', 'o'],
      },
    });
  }

  // Road routing (A*)

  private routeAlongRoads(from: [number,number], to: [number,number]): [number,number][] | null {
    if (this.roadNodes.length === 0) return null;
    if (haversineM(from[0],from[1],to[0],to[1]) > MAX_ROUTE_M) return null;

    const fn = this.nearestNode(from);
    const tn = this.nearestNode(to);
    if (fn === -1 || tn === -1 || fn === tn) return null;

    const [fnlng, fnlat] = this.roadNodes[fn];
    if (haversineM(from[0],from[1],fnlng,fnlat) > 450) return null;

    const path = this.astar(fn, tn);
    if (!path || path.length < 2) return null;

    const straight = haversineM(from[0],from[1],to[0],to[1]);
    if (pathLen(path) > straight * 4) return null;

    return path;
  }

  private nearestNode([lng,lat]: [number,number]): number {
    const cx = Math.floor(lng/this.GRID), cy = Math.floor(lat/this.GRID);
    let best = -1, bestD = Infinity;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      for (const id of this.nodeGrid.get(`${cx+dx},${cy+dy}`) ?? []) {
        const [nx,ny] = this.roadNodes[id];
        const d = (nx-lng)**2+(ny-lat)**2;
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  }

  private astar(fn: number, tn: number): [number,number][] | null {
    const [tlng,tlat] = this.roadNodes[tn];
    const g    = new Map<number,number>([[fn,0]]);
    const prev = new Map<number,{node:number; coords:[number,number][]}>();
    const heap = new MinHeap();
    const vis  = new Set<number>();
    heap.push({ id: fn, f: haversineM(this.roadNodes[fn][0],this.roadNodes[fn][1],tlng,tlat) });

    while (heap.size > 0) {
      const { id: cur } = heap.pop()!;
      if (vis.has(cur)) continue;
      vis.add(cur);
      if (cur === tn) break;
      for (const e of this.roadAdj.get(cur) ?? []) {
        if (vis.has(e.to)) continue;
        const ng = g.get(cur)! + e.dist;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          prev.set(e.to, { node: cur, coords: e.coords });
          heap.push({ id: e.to, f: ng + haversineM(this.roadNodes[e.to][0],this.roadNodes[e.to][1],tlng,tlat) });
        }
      }
    }

    if (!prev.has(tn)) return null;
    const segs: [number,number][][] = [];
    let cur = tn;
    while (cur !== fn) { const p = prev.get(cur)!; segs.unshift(p.coords); cur = p.node; }
    const path: [number,number][] = [...segs[0]];
    for (let i = 1; i < segs.length; i++) path.push(...segs[i].slice(1));
    return path;
  }

  // RAF animation loop

  private startAnimationLoop(): void {
    const loop = () => { this.tickAnimation(); this.rafHandle = requestAnimationFrame(loop); };
    this.rafHandle = requestAnimationFrame(loop);
  }

  private tickAnimation(): void {
    this.frameCount++;
    const now    = performance.now();
    const moving = this.map.isMoving();

    // Process tracers — advance every frame so animation stays smooth
    const stillActive: Tracer[]           = [];
    const headFeatures: GeoJSON.Feature[] = [];
    const tailFeatures: GeoJSON.Feature[] = [];
    const hadTracers = this.tracers.length > 0;

    for (const t of this.tracers) {
      const raw = (now - t.startTime) / TRACER_TTL_MS;
      const arc = buildArc(t, Math.min(raw, 1));

      if (raw >= 1) {
        // Cap the permanent spread-line history — unbounded growth is the
        // primary cause of GPU stall at high infection counts
        if (this.completedLines.length >= MAX_COMPLETED_LINES) {
          this.completedLines.shift(); // remove oldest
        }
        this.completedLines.push({
          type:     'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: arc },
          properties: {},
        });
        this.completedDirty = true;
        continue;
      }

      stillActive.push(t);
      const [lng, lat] = arc[arc.length - 1];
      const eased  = 1 - Math.pow(1 - raw, 3);
      const opacity = raw < 0.1 ? raw / 0.1 : 1;
      const radius  = 4 + 3 * Math.sin(raw * Math.PI);
      const color   = lerpColor('#ff003c', '#b026ff', eased);

      headFeatures.push({
        type:     'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: { opacity, radius, color },
      });
      tailFeatures.push({
        type:     'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: arc },
        properties: {},
      });
    }

    this.tracers = stillActive;

    // Always upload tracer HEADS (tiny point source — cheap)
    if (hadTracers || stillActive.length > 0) {
      (this.map.getSource('tracers') as GeoJSONSource|undefined)
        ?.setData({ type: 'FeatureCollection', features: headFeatures });
    }

    // During camera movement skip the heavy uploads (tails are large LineStrings,
    // spread-lines can be thousands of features) — they fight tile loading
    if (moving) {
      // Still clear tails so they don't ghost after pan ends
      if (hadTracers && stillActive.length === 0) {
        (this.map.getSource('tracer-tails') as GeoJSONSource|undefined)
          ?.setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }

    // Tracer tails — thick blurry lines; every-other-frame is imperceptible at 60fps
    if ((hadTracers || stillActive.length > 0) && this.frameCount % 2 === 0) {
      (this.map.getSource('tracer-tails') as GeoJSONSource|undefined)
        ?.setData({ type: 'FeatureCollection', features: tailFeatures });
    }

    // Spread-line history — throttle to every 5 frames; it's static between ticks
    if (this.completedDirty && this.frameCount % 5 === 0) {
      (this.map.getSource('spread-lines') as GeoJSONSource|undefined)
        ?.setData({ type: 'FeatureCollection', features: this.completedLines });
      this.completedDirty = false;
    }

    // Frontier breathing — every 12 frames (~5 fps) is imperceptible to humans
    if (this.frameCount % 12 === 0) {
      const t = now / 1000;
      const b = 0.65 + 0.25 * Math.sin(t * 1.9) + 0.1 * Math.sin(t * 4.3 + 1.7);
      this.map.setPaintProperty('hex-frontier', 'line-opacity', Math.max(0.3, Math.min(1, b)));
    }

    // Ring pings
    if (this.ringPings.length === 0) return;

    const liveRings: RingPing[]           = [];
    const ringFeatures: GeoJSON.Feature[] = [];

    for (const ring of this.ringPings) {
      const progress = (now - ring.startTime) / RING_TTL_MS;
      if (progress >= 1) continue;
      liveRings.push(ring);

      const eased = 1 - Math.pow(1 - progress, 2.2);
      const r     = 5 + 62 * eased;
      const o     = Math.max(0, 1 - progress * 1.15);
      const color = ring.isOverrun ? '#b026ff' : '#ff003c';

      ringFeatures.push({
        type:     'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: ring.center },
        properties: { r: r * 1.9, o: 0, bo: o * 0.18, c: color },
      });
      ringFeatures.push({
        type:     'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: ring.center },
        properties: { r, o, bo: 0, c: color },
      });
    }

    this.ringPings = liveRings;
    // Ring pings expand over ~1.4 s — 30fps upload is visually indistinguishable from 60fps
    if (this.frameCount % 2 === 0) {
      (this.map.getSource('ring-pings') as GeoJSONSource|undefined)
        ?.setData({ type: 'FeatureCollection', features: ringFeatures });
    }
  }

  // Misc

  private findRoadLayer(): string | undefined {
    const ROAD_SOURCE_LAYERS = new Set([
      'transportation', 'road', 'roads', 'highway', 'transport', 'street', 'streets',
    ]);
    return this.map.getStyle()?.layers?.find((l) => {
      const sl = (l as { 'source-layer'?: string })['source-layer'];
      return l.type === 'line' && sl && ROAD_SOURCE_LAYERS.has(sl);
    })?.id;
  }

  getMap(): MapLibreMap { return this.map; }

  // Map click / hover wiring

  onMapClick(cb: (coord: [number, number]) => void): void {
    this.clickHandler = cb;
    this.boundMapClick = (e: maplibregl.MapMouseEvent) => {
      if (this.clickHandler) this.clickHandler([e.lngLat.lng, e.lngLat.lat]);
    };
    this.map.on('click', this.boundMapClick);
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  removeClickHandler(): void {
    if (this.boundMapClick) { this.map?.off('click', this.boundMapClick); this.boundMapClick = null; }
    this.clickHandler = null;
    if (this.map) this.map.getCanvas().style.cursor = '';
  }

  onCellHover(cb: (props: Record<string,unknown>|null, xy:[number,number]|null) => void): void {
    this.hoverHandler = cb;

    this.boundMapMove = (e: maplibregl.MapMouseEvent) => {
      const features = this.map.queryRenderedFeatures(e.point, { layers: ['hex-fill'] });
      if (features.length > 0) {
        const props = features[0].properties as Record<string,unknown>;
        // Highlight on hover
        const cellId = props['cellId'] as string;
        if (cellId !== this.hoveredCellId) {
          if (this.hoveredCellId) this.map.setFeatureState({ source:'hex-grid', id: this.hoveredCellId }, { hover: false });
          this.hoveredCellId = cellId;
        }
        this.hoverHandler?.(props, [e.point.x, e.point.y]);
        this.map.getCanvas().style.cursor = 'pointer';
      } else {
        this.hoverHandler?.(null, null);
        this.hoveredCellId = null;
        if (this.clickHandler) this.map.getCanvas().style.cursor = 'crosshair';
        else this.map.getCanvas().style.cursor = '';
      }
    };

    this.boundMapLeave = () => {
      this.hoverHandler?.(null, null);
      this.hoveredCellId = null;
    };

    this.map.on('mousemove', this.boundMapMove);
    this.map.on('mouseleave', this.boundMapLeave as () => void);
  }

  removeHoverHandler(): void {
    if (this.boundMapMove)  { this.map?.off('mousemove',  this.boundMapMove);  this.boundMapMove = null; }
    if (this.boundMapLeave) { this.map?.off('mouseleave', this.boundMapLeave as () => void); this.boundMapLeave = null; }
    this.hoverHandler = null;
  }

  // Markers

  setPatientZeroMarker(center: [number, number]): void {
    this.pzMarker?.remove();
    const el = document.createElement('div');
    el.className = 'pz-marker';
    el.innerHTML = `
      <div class="pz-core">☣</div>
      <div class="pz-ring r1"></div>
      <div class="pz-ring r2"></div>
      <div class="pz-label">GROUND ZERO</div>
    `;
    this.pzMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(center)
      .addTo(this.map);
  }

  setUserMarker(center: [number, number]): void {
    this.userMarker?.remove();
    const el = document.createElement('div');
    el.className = 'user-marker';
    el.innerHTML = `<div class="um-core">👤</div><div class="um-label">YOU</div>`;
    this.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(center)
      .addTo(this.map);
  }

  clearMarkers(): void {
    this.pzMarker?.remove();   this.pzMarker = null;
    this.userMarker?.remove(); this.userMarker = null;
  }

  resetSimLayers(): void {
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    this.hexFeatures.clear();
    this.tracers = []; this.completedLines = []; this.completedDirty = false;
    this.ringPings = [];
    (['hex-grid', 'spread-lines', 'tracer-tails', 'tracers', 'ring-pings'] as const)
      .forEach((id) => (this.map.getSource(id) as GeoJSONSource | undefined)?.setData(empty));
    // Reset all building feature states in one call — clears every revealStatus
    if (this.buildingFeatures.length > 0) {
      this.map.removeFeatureState({ source: 'city-buildings' });
    }
  }

  flyTo(center: [number,number], zoom: number): void {
    this.map.flyTo({ center, zoom, pitch: 45, duration: 1800 });
  }

  destroy(): void {
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    this.hexFeatures.clear();
    this.tracers = []; this.completedLines = []; this.completedDirty = false;
    this.roadNodes = []; this.roadAdj.clear(); this.nodeGrid.clear();
    this.ringPings = [];
    this.buildingFeatures = []; this.buildingCellIndex.clear();
    this.beforeRoadsId = undefined;
    this.pzMarker?.remove();   this.pzMarker = null;
    this.userMarker?.remove(); this.userMarker = null;
    this.removeClickHandler();
    this.removeHoverHandler();
    this.map?.remove();
    this.isLoaded.set(false);
  }
}

// Pure helpers

function cellToPolygon(cell: SimCell): GeoJSON.Feature {
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
      zombieRatio: cell.population > 0 ? cell.zombie / cell.population : 0,
    },
  };
}

function buildArc(t: Tracer, progress: number): [number,number][] {
  if (t.routedPath && t.routedPath.length >= 2) {
    const total = pathLen(t.routedPath);
    if (total > 0) {
      const eased = total * (1 - Math.pow(1 - progress, 2.5));
      const sampled = samplePath(t.routedPath, eased);
      if (sampled.length >= 2) return sampled;
    }
  }
  // Bezier fallback.
  const dx = t.to[0]-t.from[0], dy = t.to[1]-t.from[1];
  const out: [number,number][] = [];
  for (let i = 0; i <= 12; i++) {
    const s = (i/12)*progress, se = 1-Math.pow(1-s,3), sb = 4*s*(1-s);
    out.push([t.from[0]+dx*se+(-dy)*t.jitter*sb, t.from[1]+dy*se+(dx)*t.jitter*sb]);
  }
  return out;
}

function samplePath(path: [number,number][], dist: number): [number,number][] {
  const out: [number,number][] = [path[0]];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = haversineM(path[i-1][0],path[i-1][1],path[i][0],path[i][1]);
    if (acc + seg >= dist) {
      const t = (dist-acc)/seg;
      out.push([path[i-1][0]+(path[i][0]-path[i-1][0])*t, path[i-1][1]+(path[i][1]-path[i-1][1])*t]);
      return out;
    }
    acc += seg; out.push(path[i]);
  }
  return out;
}

function pathLen(path: [number,number][]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++)
    d += haversineM(path[i-1][0],path[i-1][1],path[i][0],path[i][1]);
  return d;
}

function gk(lng: number, lat: number, s: number): string {
  return `${Math.floor(lng/s)},${Math.floor(lat/s)}`;
}

function haversineM(lng1:number,lat1:number,lng2:number,lat2:number): number {
  const R=6371000, toR=Math.PI/180;
  const dφ=(lat2-lat1)*toR, dλ=(lng2-lng1)*toR;
  const a=Math.sin(dφ/2)**2+Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function lerpColor(a:string,b:string,t:number):string{
  const pa=ph(a),pb=ph(b);
  return `rgb(${rv(pa[0],pb[0],t)},${rv(pa[1],pb[1],t)},${rv(pa[2],pb[2],t)})`;
}
function rv(a:number,b:number,t:number){return Math.round(a+(b-a)*t);}
function ph(h:string):[number,number,number]{
  const x=h.replace('#','');
  return [parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)];
}

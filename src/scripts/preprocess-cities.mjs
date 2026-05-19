import { fromFile } from 'geotiff';
import * as h3 from 'h3-js';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CITIES = [
  {
    name: 'lahore',
    tif: 'data/lahore_pop.tif',
    bbox: { west: 74.23, south: 31.42, east: 74.48, north: 31.65 },
    center: [74.3587, 31.5204],
    displayName: 'Lahore, Pakistan',
    osmFiles: { single: 'data/lahore.geojson' },
  },
  {
    name: 'london',
    tif: 'data/london_pop.tif',
    bbox: { west: -0.35, south: 51.38, east: 0.15, north: 51.62 },
    center: [-0.1278, 51.5074],
    displayName: 'London, UK',
    osmFiles: { roads: 'data/London_Roads.geojson', landuse: 'data/London_Landuse.geojson' },
  },
  {
    name: 'newyork',
    tif: 'data/newyork_pop.tif',
    bbox: { west: -74.26, south: 40.49, east: -73.69, north: 40.92 },
    center: [-74.006, 40.7128],
    displayName: 'New York, USA',
    osmFiles: { roads: 'data/New_York_Roads.geojson', landuse: 'data/New_York_Landuse.geojson' },
  },
  {
    name: 'tokyo',
    tif: 'data/tokyo_pop.tif',
    bbox: { west: 139.56, south: 35.52, east: 139.92, north: 35.82 },
    center: [139.6917, 35.6895],
    displayName: 'Tokyo, Japan',
    osmFiles: { roads: 'data/Tokyo_Roads.geojson', landuse: 'data/Tokyo_Landuse.geojson' },
  },
];

const H3_RESOLUTION = 9;
const OUTPUT_DIR    = join(__dirname, '../../public');

// ── OSM loading ───────────────────────────────────────────────────────────────
function loadOSMData(city) {
  let allWays = [];
  if (city.osmFiles.single) {
    allWays = parseGeoJSON(city.osmFiles.single);
  } else {
    allWays = [
      ...parseGeoJSON(city.osmFiles.roads),
      ...parseGeoJSON(city.osmFiles.landuse),
    ];
  }
  console.log(`  Loaded ${allWays.length} ways`);
  return allWays;
}

function parseGeoJSON(filePath) {
  const data = JSON.parse(readFileSync(join(__dirname, filePath), 'utf-8'));
  if (data.elements) return data.elements.filter(e => e.type === 'way' && e.geometry);
  if (data.features) {
    return data.features
      .filter(f => f.geometry && f.properties)
      .map(f => ({
        type: 'way',
        tags: f.properties,
        geometry:
          f.geometry.type === 'LineString'   ? f.geometry.coordinates.map(([lon,lat]) => ({lat,lon})) :
          f.geometry.type === 'Polygon'      ? f.geometry.coordinates[0].map(([lon,lat]) => ({lat,lon})) :
          f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0].map(([lon,lat]) => ({lat,lon})) :
          [],
      }))
      .filter(w => w.geometry.length > 0);
  }
  return [];
}

// ── Classification helpers ────────────────────────────────────────────────────
function classifyLandUse(tags) {
  if (tags.natural === 'water' || tags.waterway) return 'water';
  if (tags.leisure === 'park') return 'park';
  const lu = tags.landuse;
  if (!lu) return 'residential';
  if (['residential','apartments'].includes(lu)) return 'residential';
  if (['commercial','retail','mixed'].includes(lu)) return 'commercial';
  if (['industrial','warehouse'].includes(lu)) return 'industrial';
  if (['park','grass','meadow','forest'].includes(lu)) return 'park';
  if (lu === 'water') return 'water';
  return 'residential';
}

function classifyRoad(highway) {
  if (!highway) return 'none';
  if (['motorway','trunk'].includes(highway))             return 'highway';
  if (['primary','secondary'].includes(highway))          return 'high';
  if (['tertiary','unclassified'].includes(highway))      return 'medium';
  if (['residential','service'].includes(highway))        return 'low';
  return 'none';
}

const ROAD_RANK = { highway: 4, high: 3, medium: 2, low: 1, none: 0 };

function isRoadRouteable(highway) { return ROAD_RANK[classifyRoad(highway)] >= 2; }

// ── Geometry helpers ──────────────────────────────────────────────────────────
function isClosed(way) {
  if (way.geometry.length < 4) return false;
  const f = way.geometry[0], l = way.geometry[way.geometry.length - 1];
  return Math.abs(f.lat - l.lat) < 1e-7 && Math.abs(f.lon - l.lon) < 1e-7;
}

function haversineM(lon1, lat1, lon2, lat2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pathLenM(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++)
    d += haversineM(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
  return d;
}

// Ramer-Douglas-Peucker simplification (tolerance in degrees)
function simplify(coords, tol) {
  if (coords.length <= 2) return coords;
  const [p1, p2] = [coords[0], coords[coords.length-1]];
  let maxD = 0, maxI = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const d = ptLineDist(coords[i], p1, p2);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > tol) {
    const L = simplify(coords.slice(0, maxI+1), tol);
    const R = simplify(coords.slice(maxI), tol);
    return [...L.slice(0,-1), ...R];
  }
  return [p1, p2];
}

function ptLineDist([px,py], [x1,y1], [x2,y2]) {
  const dx = x2-x1, dy = y2-y1;
  if (!dx && !dy) return Math.sqrt((px-x1)**2+(py-y1)**2);
  const t = Math.max(0, Math.min(1, ((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy)));
  return Math.sqrt((px-x1-t*dx)**2+(py-y1-t*dy)**2);
}

function centroid(ring) {
  let x = 0, y = 0;
  ring.forEach(([lon,lat]) => { x += lon; y += lat; });
  return [x/ring.length, y/ring.length];
}

// ── Existing cell-building helpers ────────────────────────────────────────────
function pointInWay(lat, lng, way) {
  if (!way.geometry.length) return false;
  const lats = way.geometry.map(p => p.lat);
  const lngs = way.geometry.map(p => p.lon);
  return lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
         lng >= Math.min(...lngs) && lng <= Math.max(...lngs);
}

function samplePopulation(image, rasters, lat, lng, bbox) {
  const w = image.getWidth(), h = image.getHeight();
  const x = Math.floor(((lng-bbox.west)/(bbox.east-bbox.west))*w);
  const y = Math.floor(((bbox.north-lat)/(bbox.north-bbox.south))*h);
  if (x<0||x>=w||y<0||y>=h) return 0;
  const v = rasters[0][y*w+x];
  return (!v||v<0||isNaN(v)) ? 0 : Math.round(v);
}

// ── Road graph extraction ─────────────────────────────────────────────────────
function buildRoadGraph(roadWays) {
  console.log('  Building road graph...');
  const routableWays = roadWays.filter(w => isRoadRouteable(w.tags.highway));
  console.log(`  Routable ways (medium/high/highway): ${routableWays.length}`);

  // Pass 1 — count usage of each coordinate to identify intersections.
  const usage = new Map();
  for (const way of routableWays) {
    for (const pt of way.geometry) {
      const k = `${pt.lon.toFixed(6)},${pt.lat.toFixed(6)}`;
      usage.set(k, (usage.get(k) || 0) + 1);
    }
  }

  // Pass 2 — register intersection + endpoint nodes.
  const nodeKey2id = new Map();
  const nodes = [];

  function ensureNode(lon, lat) {
    const k = `${lon.toFixed(6)},${lat.toFixed(6)}`;
    if (!nodeKey2id.has(k)) {
      nodeKey2id.set(k, nodes.length);
      nodes.push([parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))]);
    }
    return nodeKey2id.get(k);
  }

  // Pre-create intersection nodes.
  for (const [k, cnt] of usage) {
    if (cnt > 1) {
      const [lonStr, latStr] = k.split(',');
      ensureNode(parseFloat(lonStr), parseFloat(latStr));
    }
  }

  // Pass 3 — walk each way, split at node points, emit edges.
  const edges = [];

  for (const way of routableWays) {
    const cls   = classifyRoad(way.tags.highway);
    const pts   = way.geometry;
    const first = pts[0], last = pts[pts.length-1];
    ensureNode(first.lon, first.lat);
    ensureNode(last.lon,  last.lat);

    let segCoords = [];
    let fromId    = null;

    for (const pt of pts) {
      const k    = `${pt.lon.toFixed(6)},${pt.lat.toFixed(6)}`;
      const isN  = nodeKey2id.has(k);
      segCoords.push([pt.lon, pt.lat]);

      if (isN && fromId === null) {
        fromId = nodeKey2id.get(k);
      } else if (isN && fromId !== null) {
        const toId = nodeKey2id.get(k);
        if (fromId !== toId && segCoords.length >= 2) {
          const simplified = simplify(segCoords, 0.000008); // ~1 m
          const dist = pathLenM(simplified);
          edges.push({ from: fromId, to: toId, dist: Math.round(dist), road: cls, coords: simplified });
          edges.push({ from: toId, to: fromId, dist: Math.round(dist), road: cls, coords: [...simplified].reverse() });
        }
        fromId    = toId;
        segCoords = [[pt.lon, pt.lat]];
      }
    }
  }

  console.log(`  Road graph: ${nodes.length} nodes, ${edges.length / 2} edges`);
  return { nodes, edges };
}

// ── Feature extraction ────────────────────────────────────────────────────────
function extractBuildings(allWays, bbox, h3res) {
  const features = [];
  const bldWays = allWays.filter(w => w.tags?.building && isClosed(w));
  console.log(`  Buildings (closed ways): ${bldWays.length}`);

  for (const way of bldWays) {
    const ring = way.geometry.map(p => [p.lon, p.lat]);
    // Bbox filter — skip if entirely outside.
    const lngs = ring.map(p => p[0]), lats = ring.map(p => p[1]);
    if (Math.min(...lngs) > bbox.east || Math.max(...lngs) < bbox.west ||
        Math.min(...lats) > bbox.north || Math.max(...lats) < bbox.south) continue;

    const simplified = simplify(ring, 0.000015); // ~1.5 m
    if (simplified.length < 4) continue;
    // Close the ring.
    if (simplified[0][0] !== simplified[simplified.length-1][0])
      simplified.push(simplified[0]);

    const [clon, clat] = centroid(simplified);
    const cellId = h3.latLngToCell(clat, clon, h3res);

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [simplified] },
      properties: {
        btype:  classifyBuildingType(way.tags),
        cellId,
      },
    });
  }
  return features;
}

function classifyBuildingType(tags) {
  const b = tags.building;
  if (['commercial','retail','office','shop'].includes(b))                return 'commercial';
  if (['industrial','warehouse','factory'].includes(b))                   return 'industrial';
  if (['school','university','hospital','public','civic'].includes(b))    return 'civic';
  if (['house','residential','apartments','detached'].includes(b))        return 'residential';
  return 'residential';
}

function extractParks(allWays, bbox) {
  return extractPolygons(
    allWays.filter(w =>
      isClosed(w) && (
        w.tags?.leisure === 'park' ||
        ['park','grass','meadow','forest','recreation_ground'].includes(w.tags?.landuse)
      )
    ),
    bbox,
    0.00003,
    () => ({}),
  );
}

function extractWater(allWays, bbox) {
  return extractPolygons(
    allWays.filter(w => isClosed(w) && (w.tags?.natural === 'water' || w.tags?.waterway === 'riverbank')),
    bbox,
    0.00003,
    () => ({}),
  );
}

function extractPolygons(ways, bbox, tol, propsFn) {
  const features = [];
  for (const way of ways) {
    const ring = way.geometry.map(p => [p.lon, p.lat]);
    const lngs = ring.map(p => p[0]), lats = ring.map(p => p[1]);
    if (Math.min(...lngs) > bbox.east || Math.max(...lngs) < bbox.west ||
        Math.min(...lats) > bbox.north || Math.max(...lats) < bbox.south) continue;
    const simplified = simplify(ring, tol);
    if (simplified.length < 4) continue;
    if (simplified[0][0] !== simplified[simplified.length-1][0])
      simplified.push(simplified[0]);
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [simplified] },
      properties: propsFn(way.tags),
    });
  }
  return features;
}

// ── Main per-city processor ───────────────────────────────────────────────────
async function processCity(city) {
  console.log(`\nProcessing ${city.displayName}...`);

  console.log('  Loading GeoTIFF...');
  const tiff    = await fromFile(join(__dirname, city.tif));
  const image   = await tiff.getImage();
  const rasters = await image.readRasters();

  console.log('  Generating H3 grid...');
  const polygon = [
    [city.bbox.north, city.bbox.west],
    [city.bbox.north, city.bbox.east],
    [city.bbox.south, city.bbox.east],
    [city.bbox.south, city.bbox.west],
    [city.bbox.north, city.bbox.west],
  ];
  const hexIds = h3.polygonToCells(polygon, H3_RESOLUTION);
  console.log(`  ${hexIds.length} H3 cells`);

  const allWays = loadOSMData(city);
  const landUseWays = allWays.filter(w => w.tags?.landuse || w.tags?.natural || w.tags?.leisure);
  const roadWays    = allWays.filter(w => w.tags?.highway);
  const hierarchy   = ['none','low','medium','high','highway'];

  console.log('  Building cells...');
  const cells = hexIds.map(hexId => {
    const [lat, lng] = h3.cellToLatLng(hexId);
    const population = samplePopulation(image, rasters, lat, lng, city.bbox);

    let landUse = 'residential';
    for (const way of landUseWays) {
      if (pointInWay(lat, lng, way)) { landUse = classifyLandUse(way.tags); break; }
    }

    let roads = 'none';
    for (const way of roadWays) {
      if (pointInWay(lat, lng, way)) {
        const rc = classifyRoad(way.tags.highway);
        if (hierarchy.indexOf(rc) > hierarchy.indexOf(roads)) roads = rc;
      }
    }

    return { cellId: hexId, center: [lng, lat], population, landUse, roads,
             status: 'clean', infected: 0, zombie: 0, dead: 0, susceptible: population };
  });

  const totalPop    = cells.reduce((s, c) => s + c.population, 0);
  const nonZero     = cells.filter(c => c.population > 0).length;
  console.log(`  Population: ${totalPop.toLocaleString()}, populated cells: ${nonZero}`);

  // ── Extract richer data ──────────────────────────────────────────────────
  const roadGraph = buildRoadGraph(roadWays);

  console.log('  Extracting buildings...');
  const buildings = extractBuildings(allWays, city.bbox, H3_RESOLUTION);
  console.log(`  Buildings: ${buildings.length}`);

  console.log('  Extracting parks...');
  const parks = extractParks(allWays, city.bbox);
  console.log(`  Parks: ${parks.length}`);

  console.log('  Extracting water...');
  const water = extractWater(allWays, city.bbox);
  console.log(`  Water: ${water.length}`);

  const output = {
    name: city.name,
    displayName: city.displayName,
    center: city.center,
    bbox: city.bbox,
    resolution: H3_RESOLUTION,
    totalPopulation: totalPop,
    cellCount: cells.length,
    generatedAt: new Date().toISOString(),
    cells,
    roadGraph,
    buildings,
    parks,
    water,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = join(OUTPUT_DIR, `${city.name}.json`);
  writeFileSync(outPath, JSON.stringify(output));
  const kb = Math.round(JSON.stringify(output).length / 1024);
  console.log(`  Written to ${outPath} (~${kb} KB)`);
}

async function main() {
  console.log('ZombieMap City Pre-processor');
  console.log('============================');
  console.log('NOTE: OSM files must be in src/scripts/data/');
  console.log('  Lahore:   data/lahore.geojson');
  console.log('  London:   data/London_Roads.geojson + data/London_Landuse.geojson');
  console.log('  New York: data/New_York_Roads.geojson + data/New_York_Landuse.geojson');
  console.log('  Tokyo:    data/Tokyo_Roads.geojson + data/Tokyo_Landuse.geojson');
  console.log('');

  for (const city of CITIES) {
    try {
      await processCity(city);
    } catch (err) {
      console.error(`  ERROR processing ${city.name}:`, err.message);
    }
  }
  console.log('\nDone.');
}

main();

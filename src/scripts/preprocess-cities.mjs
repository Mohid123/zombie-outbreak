// scripts/preprocess-cities.mjs
import { fromFile } from 'geotiff';
import * as h3 from 'h3-js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// City definitions
const CITIES = [
  {
    name: 'lahore',
    tif: 'data/lahore_pop.tif',
    bbox: { west: 74.23, south: 31.42, east: 74.48, north: 31.65 },
    center: [74.3587, 31.5204],
    displayName: 'Lahore, Pakistan',
  },
  {
    name: 'london',
    tif: 'data/london_pop.tif',
    bbox: { west: -0.35, south: 51.38, east: 0.15, north: 51.62 },
    center: [-0.1278, 51.5074],
    displayName: 'London, UK',
  },
  {
    name: 'newyork',
    tif: 'data/newyork_pop.tif',
    bbox: { west: -74.26, south: 40.49, east: -73.69, north: 40.92 },
    center: [-74.006, 40.7128],
    displayName: 'New York, USA',
  },
  {
    name: 'tokyo',
    tif: 'data/tokyo_pop.tif',
    bbox: { west: 139.56, south: 35.52, east: 139.92, north: 35.82 },
    center: [139.6917, 35.6895],
    displayName: 'Tokyo, Japan',
  },
  {
    name: 'saopaulo',
    tif: 'data/saopaulo_pop.tif',
    bbox: { west: -46.83, south: -23.72, east: -46.36, north: -23.36 },
    center: [-46.6333, -23.5505],
    displayName: 'São Paulo, Brazil',
  },
];

const H3_RESOLUTION = 9; // ~1.2km edge length, good for city-scale
const OUTPUT_DIR = join(__dirname, './src/assets/cities');

// Overpass query for land use + roads
async function fetchOSMData(bbox, retries = 3) {
  const { south, west, north, east } = bbox;

  const query = `
    [out:json][timeout:60];
    (
      way["landuse"](${south},${west},${north},${east});
      way["highway"](${south},${west},${north},${east});
      way["natural"="water"](${south},${west},${north},${east});
      way["leisure"="park"](${south},${west},${north},${east});
    );
    out geom;
  `;

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`  Fetching OSM data (attempt ${attempt}/${retries})...`);

    const response = await fetch('https://overpass.kumi.systems/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (response.ok) return response.json();

    console.log(`  Got ${response.status} — waiting 60s before retry...`);
    await new Promise((r) => setTimeout(r, 60000));
  }

  throw new Error(`Overpass failed after ${retries} attempts`);
}

// Classify land use from OSM tags
function classifyLandUse(tags) {
  if (tags.natural === 'water') return 'water';
  if (tags.leisure === 'park') return 'park';

  const landuse = tags.landuse;
  if (!landuse) return 'residential'; // default

  if (['residential', 'apartments'].includes(landuse)) return 'residential';
  if (['commercial', 'retail', 'mixed'].includes(landuse)) return 'commercial';
  if (['industrial', 'warehouse'].includes(landuse)) return 'industrial';
  if (['park', 'grass', 'meadow', 'forest'].includes(landuse)) return 'park';
  if (landuse === 'water') return 'water';

  return 'residential';
}

// Classify road density from OSM highway tags
function classifyRoad(highway) {
  if (!highway) return 'none';
  if (['motorway', 'trunk'].includes(highway)) return 'highway';
  if (['primary', 'secondary'].includes(highway)) return 'high';
  if (['tertiary', 'unclassified'].includes(highway)) return 'medium';
  if (['residential', 'service'].includes(highway)) return 'low';
  return 'none';
}

// Check if a point is inside an OSM way's geometry
function pointInWay(lat, lng, way) {
  // Simple bbox check for performance — good enough for cell tagging
  const lats = way.geometry.map((p) => p.lat);
  const lngs = way.geometry.map((p) => p.lon);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

// Sample population from GeoTIFF at a lat/lng
function samplePopulation(image, rasters, lat, lng, bbox) {
  const width = image.getWidth();
  const height = image.getHeight();
  const { west, east, north, south } = bbox;

  // Convert lat/lng to pixel coordinates
  const x = Math.floor(((lng - west) / (east - west)) * width);
  const y = Math.floor(((north - lat) / (north - south)) * height);

  // Bounds check
  if (x < 0 || x >= width || y < 0 || y >= height) return 0;

  const pixelIndex = y * width + x;
  const value = rasters[0][pixelIndex];

  // WorldPop uses -99999 or NaN for no-data
  if (!value || value < 0 || isNaN(value)) return 0;

  return Math.round(value);
}

// Process a single city
async function processCity(city) {
  console.log(`\nProcessing ${city.displayName}...`);

  // 1. Load the GeoTIFF
  console.log('  Loading GeoTIFF...');
  const tiff = await fromFile(join(__dirname, city.tif));
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const width = image.getWidth();
  const height = image.getHeight();
  console.log(`  Raster size: ${width} x ${height} pixels`);

  // 2. Generate H3 grid
  console.log('  Generating H3 grid...');
  const polygon = [
    [city.bbox.north, city.bbox.west],
    [city.bbox.north, city.bbox.east],
    [city.bbox.south, city.bbox.east],
    [city.bbox.south, city.bbox.west],
    [city.bbox.north, city.bbox.west],
  ];

  const hexIds = h3.polygonToCells(polygon, H3_RESOLUTION);
  console.log(`  Generated ${hexIds.length} H3 cells`);

  // 3. Fetch OSM data
  const osmData = await fetchOSMData(city.bbox);
  const ways = osmData.elements.filter((e) => e.type === 'way' && e.geometry);
  console.log(`  Got OSM WAYS: ${ways}`);

  // Separate land use and road ways
  const landUseWays = ways.filter((w) => w.tags?.landuse || w.tags?.natural || w.tags?.leisure);
  const roadWays = ways.filter((w) => w.tags?.highway);

  // 4. Build cells
  console.log('  Building cells...');
  const cells = hexIds.map((hexId) => {
    const [lat, lng] = h3.cellToLatLng(hexId);

    // Sample population
    const population = samplePopulation(image, rasters, lat, lng, city.bbox);

    // Determine land use — find first matching OSM way
    let landUse = 'residential';
    for (const way of landUseWays) {
      if (pointInWay(lat, lng, way)) {
        landUse = classifyLandUse(way.tags);
        break;
      }
    }

    // Determine road density — find highest-class road nearby
    let roads = 'none';
    for (const way of roadWays) {
      if (pointInWay(lat, lng, way)) {
        const roadClass = classifyRoad(way.tags.highway);
        // Take the highest road class found
        const hierarchy = ['none', 'low', 'medium', 'high', 'highway'];
        if (hierarchy.indexOf(roadClass) > hierarchy.indexOf(roads)) {
          roads = roadClass;
        }
      }
    }

    return {
      cellId: hexId,
      center: [lng, lat], // [lng, lat] — GeoJSON order
      population,
      landUse,
      roads,
      status: 'clean',
      infected: 0,
      zombie: 0,
      dead: 0,
      susceptible: population,
    };
  });

  // 5. Stats summary
  const totalPop = cells.reduce((sum, c) => sum + c.population, 0);
  const nonZeroCells = cells.filter((c) => c.population > 0).length;
  console.log(`  Total population: ${totalPop.toLocaleString()}`);
  console.log(`  Populated cells: ${nonZeroCells} / ${cells.length}`);

  // 6. Write output
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
  };

  const outPath = join(OUTPUT_DIR, `${city.name}.json`);
  writeFileSync(outPath, JSON.stringify(output));
  console.log(`  Written to ${outPath}`);
  console.log(`  File size: ~${Math.round(JSON.stringify(output).length / 1024)}kb`);
}

// Main
async function main() {
  console.log('ZombieMap City Pre-processor');
  console.log('============================');

  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (let i = 0; i < CITIES.length; i++) {
    const city = CITIES[i];

    // Wait before every city including the first
    if (i > 0) {
      console.log('\n  Waiting 30s before next city...');
      await new Promise((r) => setTimeout(r, 30000));
    }

    try {
      await processCity(city);
    } catch (err) {
      console.error(`  ERROR processing ${city.name}:`, err.message);
    }
  }

  console.log('\nDone! All cities processed.');
}

main();

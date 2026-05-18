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
    osmFiles: {
      single: 'data/lahore.geojson', // lahore has one combined file
    },
  },
  {
    name: 'london',
    tif: 'data/london_pop.tif',
    bbox: { west: -0.35, south: 51.38, east: 0.15, north: 51.62 },
    center: [-0.1278, 51.5074],
    displayName: 'London, UK',
    osmFiles: {
      roads: 'data/London_Roads.geojson',
      landuse: 'data/London_Landuse.geojson',
    },
  },
  {
    name: 'newyork',
    tif: 'data/newyork_pop.tif',
    bbox: { west: -74.26, south: 40.49, east: -73.69, north: 40.92 },
    center: [-74.006, 40.7128],
    displayName: 'New York, USA',
    osmFiles: {
      roads: 'data/New_York_Roads.geojson',
      landuse: 'data/New_York_Landuse.geojson',
    },
  },
  {
    name: 'tokyo',
    tif: 'data/tokyo_pop.tif',
    bbox: { west: 139.56, south: 35.52, east: 139.92, north: 35.82 },
    center: [139.6917, 35.6895],
    displayName: 'Tokyo, Japan',
    osmFiles: {
      roads: 'data/Tokyo_Roads.geojson',
      landuse: 'data/Tokyo_Landuse.geojson',
    },
  },
  // {
  //   name: 'saopaulo',
  //   tif: 'data/saopaulo_pop.tif',
  //   bbox: { west: -46.83, south: -23.72, east: -46.36, north: -23.36 },
  //   center: [-46.6333, -23.5505],
  //   displayName: 'São Paulo, Brazil',
  //   osmFiles: {
  //     roads:   'data/Sao_Paulo_Roads.geojson',
  //     landuse: 'data/Sao_Paulo_Landuse.geojson',
  //   },
  // },
];

const H3_RESOLUTION = 9;
const OUTPUT_DIR = join(__dirname, './src/assets/cities');

// OSM loader — handles both single file and split roads/landuse files
function loadOSMData(city) {
  console.log('  Loading OSM data from file(s)...');

  let allWays = [];

  if (city.osmFiles.single) {
    // Lahore — one combined geojson file
    allWays = parseGeoJSON(city.osmFiles.single);
  } else {
    // All other cities — merge roads and landuse files
    const roadWays = parseGeoJSON(city.osmFiles.roads);
    const landuseWays = parseGeoJSON(city.osmFiles.landuse);
    allWays = [...roadWays, ...landuseWays];
  }

  console.log(`  Loaded ${allWays.length} total ways`);
  return { elements: allWays };
}

// ── Parse a single GeoJSON file into the internal way format ─────────────────
function parseGeoJSON(filePath) {
  const fullPath = join(__dirname, filePath);
  const data = JSON.parse(readFileSync(fullPath, 'utf-8'));

  // Handle both Overpass JSON format and GeoJSON format
  if (data.elements) {
    // Overpass raw JSON — already in the right shape
    return data.elements.filter((e) => e.type === 'way' && e.geometry);
  }

  if (data.features) {
    // GeoJSON format — remap to internal shape
    return data.features
      .filter((f) => f.geometry && f.properties)
      .map((f) => ({
        type: 'way',
        tags: f.properties,
        geometry:
          f.geometry.type === 'LineString'
            ? f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }))
            : f.geometry.type === 'Polygon'
              ? f.geometry.coordinates[0].map(([lon, lat]) => ({ lat, lon }))
              : f.geometry.type === 'MultiPolygon'
                ? f.geometry.coordinates[0][0].map(([lon, lat]) => ({ lat, lon }))
                : [],
      }))
      .filter((w) => w.geometry.length > 0);
  }

  console.warn(`  WARNING: Unrecognised format in ${filePath}`);
  return [];
}

// ── Classify land use from OSM tags ──────────────────────────────────────────
function classifyLandUse(tags) {
  if (tags.natural === 'water') return 'water';
  if (tags.leisure === 'park') return 'park';

  const landuse = tags.landuse;
  if (!landuse) return 'residential';

  if (['residential', 'apartments'].includes(landuse)) return 'residential';
  if (['commercial', 'retail', 'mixed'].includes(landuse)) return 'commercial';
  if (['industrial', 'warehouse'].includes(landuse)) return 'industrial';
  if (['park', 'grass', 'meadow', 'forest'].includes(landuse)) return 'park';
  if (landuse === 'water') return 'water';

  return 'residential';
}

// ── Classify road density from OSM highway tags ───────────────────────────────
function classifyRoad(highway) {
  if (!highway) return 'none';
  if (['motorway', 'trunk'].includes(highway)) return 'highway';
  if (['primary', 'secondary'].includes(highway)) return 'high';
  if (['tertiary', 'unclassified'].includes(highway)) return 'medium';
  if (['residential', 'service'].includes(highway)) return 'low';
  return 'none';
}

// ── Point in way bbox check ───────────────────────────────────────────────────
function pointInWay(lat, lng, way) {
  if (!way.geometry || way.geometry.length === 0) return false;

  const lats = way.geometry.map((p) => p.lat);
  const lngs = way.geometry.map((p) => p.lon);

  return (
    lat >= Math.min(...lats) &&
    lat <= Math.max(...lats) &&
    lng >= Math.min(...lngs) &&
    lng <= Math.max(...lngs)
  );
}

// ── Sample population from GeoTIFF ───────────────────────────────────────────
function samplePopulation(image, rasters, lat, lng, bbox) {
  const width = image.getWidth();
  const height = image.getHeight();
  const { west, east, north, south } = bbox;

  const x = Math.floor(((lng - west) / (east - west)) * width);
  const y = Math.floor(((north - lat) / (north - south)) * height);

  if (x < 0 || x >= width || y < 0 || y >= height) return 0;

  const value = rasters[0][y * width + x];
  if (!value || value < 0 || isNaN(value)) return 0;

  return Math.round(value);
}

//Process a single city
async function processCity(city) {
  console.log(`\nProcessing ${city.displayName}...`);

  // 1. Load GeoTIFF
  console.log('  Loading GeoTIFF...');
  const tiff = await fromFile(join(__dirname, city.tif));
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  console.log(`  Raster size: ${image.getWidth()} x ${image.getHeight()} pixels`);

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

  // 3. Load OSM data from local files
  const osmData = loadOSMData(city);
  const ways = osmData.elements;

  const landUseWays = ways.filter((w) => w.tags?.landuse || w.tags?.natural || w.tags?.leisure);
  const roadWays = ways.filter((w) => w.tags?.highway);
  console.log(`  Land use ways: ${landUseWays.length} | Road ways: ${roadWays.length}`);

  // 4. Build cells
  console.log('  Building cells...');
  const hierarchy = ['none', 'low', 'medium', 'high', 'highway'];

  const cells = hexIds.map((hexId) => {
    const [lat, lng] = h3.cellToLatLng(hexId);
    const population = samplePopulation(image, rasters, lat, lng, city.bbox);

    let landUse = 'residential';
    for (const way of landUseWays) {
      if (pointInWay(lat, lng, way)) {
        landUse = classifyLandUse(way.tags);
        break;
      }
    }

    let roads = 'none';
    for (const way of roadWays) {
      if (pointInWay(lat, lng, way)) {
        const roadClass = classifyRoad(way.tags.highway);
        if (hierarchy.indexOf(roadClass) > hierarchy.indexOf(roads)) {
          roads = roadClass;
        }
      }
    }

    return {
      cellId: hexId,
      center: [lng, lat],
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

  // 5. Stats
  const totalPop = cells.reduce((sum, c) => sum + c.population, 0);
  const nonZeroCells = cells.filter((c) => c.population > 0).length;
  console.log(`  Total population: ${totalPop.toLocaleString()}`);
  console.log(`  Populated cells:  ${nonZeroCells} / ${cells.length}`);

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

  for (const city of CITIES) {
    try {
      await processCity(city);
    } catch (err) {
      console.error(`  ERROR processing ${city.name}:`, err.message);
    }
  }

  console.log('\nDone! All cities processed.');
}

main();

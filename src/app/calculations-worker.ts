/// <reference lib="webworker" />

import * as h3 from 'h3-js';
import {
  CellStatus,
  SimCell,
  SimStats,
  TickResult,
  WorkerMessage,
  WorkerResponse,
  ZombieVariant,
} from './@core/interfaces/simulation.model';

//Seeded PRNG
// Deterministic random — same seed = same simulation every time
// Mulberry32 algorithm — fast and good enough for a sim
function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Worker state — lives here, never sent to main thread in full
let grid: Map<string, SimCell> = new Map();
let rng: () => number = Math.random;
let variant: ZombieVariant = 'standard';
let tickCount = 0;
let isRunning = false;

//Greek letter constants
const GAMMA = 0.15; // I to Z conversion rate per tick
const DELTA = 0.05; // Z destroyed by humans per tick
const MU = 0.08; // S killed outright by Z per tick

//Variant ring sizes
const VARIANT_RING: Record<ZombieVariant, number> = {
  standard: 1,
  fast: 2,
  horde: 1,
};

//Message handler
addEventListener('message', ({ data }: MessageEvent<WorkerMessage>) => {
  switch (data.type) {
    case 'INIT': {
      grid = new Map(data.payload.grid.map((cell: any) => [cell.cellId, { ...cell }]));
      variant = data.payload.variant;
      rng = createRng(data.payload.seed);
      tickCount = 0;
      isRunning = true;

      // Place Patient Zero
      const pzCell = data.payload.patientZeroCell;
      if (pzCell && grid.has(pzCell)) {
        const cell = grid.get(pzCell)!;
        cell.status = 'infected';
        cell.infected = Math.max(1, Math.floor(cell.population * 0.01));
        cell.zombie = 1;
        cell.susceptible = cell.population - cell.infected - 1;
      }

      const response: WorkerResponse = { type: 'INIT_COMPLETE' };
      postMessage(response);
      break;
    }

    case 'TICK': {
      if (!isRunning) break;
      const result = computeTick();
      tickCount++;

      const response: WorkerResponse = { type: 'TICK_RESULT', payload: result };
      postMessage(response);

      // Check end condition
      if (isSimulationOver()) {
        isRunning = false;
        const endResponse: WorkerResponse = {
          type: 'SIM_ENDED',
          payload: computeStats(),
        };
        postMessage(endResponse);
      }
      break;
    }

    case 'PAUSE': {
      isRunning = false;
      break;
    }

    case 'RESUME': {
      isRunning = true;
      break;
    }

    case 'TERMINATE': {
      isRunning = false;
      grid.clear();
      break;
    }
  }
});

//Core tick computation
function computeTick(): TickResult {
  const dirtyCellIds = new Set<string>();

  // Step 1 — Spread to neighbors from all active cells
  for (const [cellId, cell] of grid) {
    if (cell.status !== 'infected' && cell.status !== 'overrun') continue;
    if (cell.zombie <= 0) continue;

    const ringSize = VARIANT_RING[variant];
    const neighborIds = h3.gridDisk(cellId, ringSize).filter((id) => id !== cellId);

    for (const neighborId of neighborIds) {
      const neighbor = grid.get(neighborId);
      if (!neighbor || neighbor.status !== 'clean') continue;
      if (neighbor.population <= 0) continue;

      const p = spreadProbability(cell, neighbor);

      if (rng() < p) {
        // Infect the neighbor — seed it with a small initial zombie count
        neighbor.zombie = 1;
        neighbor.infected = Math.max(1, Math.floor(neighbor.population * 0.005));
        neighbor.susceptible = neighbor.population - neighbor.infected - 1;
        neighbor.status = 'infected';
        neighbor.infectedAtTick = tickCount;
        dirtyCellIds.add(neighborId);
      }
    }
  }

  // Step 2 — Run SIZD math on every active cell
  for (const [cellId, cell] of grid) {
    if (cell.status === 'clean' || cell.status === 'abandoned') continue;
    if (cell.zombie <= 0 && cell.infected <= 0) continue;

    const updated = applySIZD(cell);
    grid.set(cellId, updated);
    dirtyCellIds.add(cellId);
  }

  // Step 3 — Collect dirty cells and stats
  const updatedCells = [...dirtyCellIds].map((id) => grid.get(id)!);

  return {
    updatedCells,
    stats: computeStats(),
    tick: tickCount,
  };
}

//SIZD math
function applySIZD(cell: SimCell): SimCell {
  const { susceptible: S, infected: I, zombie: Z, dead: D, population } = cell;

  if (population <= 0) return cell;

  // Calculate β for this cell based on its own density and land use
  const β = baseBeta(cell);

  // All four transfers — calculated from OLD values simultaneously
  const contactRate = Z / population;
  const newInfections = β * S * contactRate;
  const newZombies = GAMMA * I;
  const zombiesKilled = DELTA * Z * (S / population);
  const humansDead = MU * Z * contactRate;

  // Apply transfers
  const newS = Math.max(0, S - newInfections - humansDead);
  const newI = Math.max(0, I + newInfections - newZombies);
  const newZ = Math.max(0, Z + newZombies - zombiesKilled);
  const newD = D + humansDead + zombiesKilled;

  // Derive new cell status from thresholds
  const newStatus = deriveCellStatus(newZ, newS, population);

  return {
    ...cell,
    susceptible: Math.round(newS),
    infected: Math.round(newI),
    zombie: Math.round(newZ),
    dead: Math.round(newD),
    status: newStatus,
  };
}

// Base β for SIZD (internal to cell, not spread)
function baseBeta(cell: SimCell): number {
  let β = 0.35;

  // Density modifier
  const density = Math.min(cell.population / 50000, 1);
  β += density * 0.25;

  // Land use modifier
  const landUseBonus: Record<string, number> = {
    commercial: 0.2,
    residential: 0.15,
    industrial: -0.05,
    park: -0.1,
    water: -0.99,
  };
  β += landUseBonus[cell.landUse] ?? 0;

  return Math.max(0, Math.min(1, β));
}

// Spread probability between two cells
function spreadProbability(source: SimCell, target: SimCell): number {
  let β = 0.35;

  // Factor 1 — infection intensity of source
  const intensity = source.zombie / source.population;
  if (intensity > 0.8) β *= 1.4;
  else if (intensity > 0.5) β *= 1.2;
  else if (intensity < 0.2) β *= 0.7;

  // Factor 2 — target population density
  const density = Math.min(target.population / 50000, 1);
  β += density * 0.25;

  // Factor 3 — road network of target
  const roadBonus: Record<string, number> = {
    highway: 0.45,
    high: 0.25,
    medium: 0.1,
    low: 0.02,
    none: -0.05,
  };
  β += roadBonus[target.roads] ?? 0;

  // Factor 4 — land use of target
  const landBonus: Record<string, number> = {
    commercial: 0.2,
    residential: 0.15,
    industrial: -0.05,
    park: -0.1,
    water: -0.99,
  };
  β += landBonus[target.landUse] ?? 0;

  // Factor 5 — distance decay using H3 cell centres
  const [srcLat, srcLng] = h3.cellToLatLng(source.cellId);
  const [tgtLat, tgtLng] = h3.cellToLatLng(target.cellId);
  const distKm = haversineKm(srcLat, srcLng, tgtLat, tgtLng);
  const decay = Math.exp(-distKm * 2.5);
  β *= decay;

  // Factor 6 — stochastic noise
  β += (rng() - 0.5) * 0.1;

  // Clamp to valid probability
  return Math.max(0, Math.min(1, β));
}

// Cell status thresholds
function deriveCellStatus(zombie: number, susceptible: number, population: number): CellStatus {
  if (population <= 0) return 'abandoned';

  const zombieRatio = zombie / population;
  const survivorRatio = susceptible / population;

  if (zombieRatio > 0.6) return 'overrun';
  if (zombieRatio > 0.1) return 'infected';
  if (survivorRatio < 0.05) return 'abandoned';
  return 'clean';
}

// End condition
function isSimulationOver(): boolean {
  let totalSurvivors = 0;
  let totalZombies = 0;

  for (const cell of grid.values()) {
    totalSurvivors += cell.susceptible;
    totalZombies += cell.zombie;
  }

  // Sim ends when no survivors remain OR no zombies remain (burned out)
  return totalSurvivors <= 0 || totalZombies <= 0;
}

// Stats computation
function computeStats(): SimStats {
  let totalSusceptible = 0;
  let totalInfected = 0;
  let totalZombie = 0;
  let totalDead = 0;
  let overrunCells = 0;
  let totalCells = 0;

  for (const cell of grid.values()) {
    totalSusceptible += cell.susceptible;
    totalInfected += cell.infected;
    totalZombie += cell.zombie;
    totalDead += cell.dead;
    totalCells++;
    if (cell.status === 'overrun') overrunCells++;
  }

  const totalPopulation = totalSusceptible + totalInfected + totalZombie + totalDead;

  return {
    totalSurvivors: totalSusceptible,
    totalInfected,
    totalZombie,
    totalDead,
    survivalRate: totalPopulation > 0 ? totalSusceptible / totalPopulation : 0,
    cityOverrunPct: totalCells > 0 ? overrunCells / totalCells : 0,
    hoursElapsed: tickCount,
  };
}

// Haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

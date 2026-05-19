/// <reference lib="webworker" />

import * as h3 from 'h3-js';
import {
  CellStatus,
  SimCell,
  SimStats,
  SpreadEvent,
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

// Per-simulation wind vector (radians) — gives the spread a coherent direction
// instead of perfectly radial growth. Magnitude controls bias strength.
let windAngle = 0;
let windStrength = 0.18;

// SIZD rates — tuned so cells spend many ticks as "infected" before becoming "overrun"
const GAMMA = 0.06; // I→Z conversion: slow, creates long infected phase
const DELTA = 0.03; // Z killed by humans: low, zombies persist
const MU    = 0.05; // S killed outright: moderate

const VARIANT_RING: Record<ZombieVariant, number> = {
  standard: 1,
  fast: 2,
  horde: 1,
};

// Panic-flight long-jump — slightly higher to seed distant outbreaks (city coverage)
const LONG_JUMP_BASE_P = 0.022;

//Message handler
addEventListener('message', ({ data }: MessageEvent<WorkerMessage>) => {
  switch (data.type) {
    case 'INIT': {
      grid = new Map(data.payload.grid.map((cell: any) => [cell.cellId, { ...cell }]));
      variant = data.payload.variant;
      rng = createRng(data.payload.seed);
      tickCount = 0;
      isRunning = true;

      // Pick a wind direction so the spread leans one way — feels less like
      // a perfect circle, more like a real outbreak chasing transit + weather.
      windAngle = rng() * Math.PI * 2;
      windStrength = 0.14 + rng() * 0.10;

      // Place Patient Zero — seed enough zombies to clear the overrun threshold
      // quickly so SIZD has traction from tick 1.
      const pzCell = data.payload.patientZeroCell;
      if (pzCell && grid.has(pzCell)) {
        const cell = grid.get(pzCell)!;
        const pop = Math.max(cell.population, 20);
        cell.zombie    = Math.max(10, Math.floor(pop * 0.15));
        cell.infected  = Math.max(10, Math.floor(pop * 0.05));
        cell.susceptible = Math.max(0, pop - cell.zombie - cell.infected);
        cell.status = 'infected';
        cell.infectedAtTick = 0;
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
  const spreadEvents: SpreadEvent[] = [];

  // Step 1 — Spread to neighbors from all active cells
  for (const [cellId, cell] of grid) {
    if (cell.status !== 'infected' && cell.status !== 'overrun') continue;
    if (cell.zombie <= 0) continue;

    // Maturity gate — a freshly-infected cell is mostly incubating and
    // spreads sluggishly; cells that have brewed a few ticks erupt outward.
    // This staggers the wavefront so growth pulses instead of marching uniformly.
    const ticksInfected = tickCount - (cell.infectedAtTick ?? tickCount);
    const maturity = Math.min(1, ticksInfected / 4); // 0 → 1 over ~4 ticks
    const maturityFactor = 0.25 + 0.75 * maturity;

    const ringSize = VARIANT_RING[variant];
    const neighborIds = h3.gridDisk(cellId, ringSize).filter((id) => id !== cellId);

    for (const neighborId of neighborIds) {
      const neighbor = grid.get(neighborId);
      if (!neighbor || neighbor.status !== 'clean') continue;
      if (neighbor.population <= 0) continue;

      const p = spreadProbability(cell, neighbor) * maturityFactor;

      if (rng() < p) {
        infectCell(neighbor, 0.005);
        dirtyCellIds.add(neighborId);
        spreadEvents.push({ fromCenter: cell.center, toCenter: neighbor.center });
      }
    }

    // Step 1b — Panic-flight long jump: an overrun, mature cell on the
    // highway / high-road network occasionally seeds a distant cell as
    // people flee. Creates non-contiguous flare-ups instead of a clean disc.
    if (cell.status === 'overrun' && maturity >= 1 && hasTransit(cell)) {
      if (rng() < LONG_JUMP_BASE_P) {
        const jumpRing = 3 + Math.floor(rng() * 3); // ring 3..5
        const candidates = h3.gridRing(cellId, jumpRing);
        if (candidates.length > 0) {
          const target = candidates[Math.floor(rng() * candidates.length)];
          const tgt = grid.get(target);
          if (tgt && tgt.status === 'clean' && tgt.population > 0 && hasTransit(tgt)) {
            infectCell(tgt, 0.003);
            dirtyCellIds.add(target);
            spreadEvents.push({ fromCenter: cell.center, toCenter: tgt.center });
          }
        }
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
    spreadEvents,
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
  let β = 0.26;

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
  let β = 0.26;

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

  // Factor 3b — wavefront amplification: when BOTH source and target sit on
  // strong road links, push spread along that corridor (Mapzilla wavefront).
  if (roadWeight(source.roads) >= 2 && roadWeight(target.roads) >= 2) {
    β += 0.18;
  }

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

  // Factor 6 — wind bias: bearing alignment with the per-sim wind vector.
  // dot(direction, wind) ∈ [-1, 1] — cells downwind get a boost, upwind a drag.
  const bearing = Math.atan2(tgtLat - srcLat, tgtLng - srcLng);
  const alignment = Math.cos(bearing - windAngle);
  β += alignment * windStrength;

  // Factor 7 — stochastic noise
  β += (rng() - 0.5) * 0.12;

  // Clamp to valid probability
  return Math.max(0, Math.min(1, β));
}

// Seed an infection into a previously-clean cell.
function infectCell(cell: SimCell, infectedPct: number): void {
  cell.zombie = 1;
  cell.infected = Math.max(1, Math.floor(cell.population * infectedPct));
  cell.susceptible = cell.population - cell.infected - 1;
  cell.status = 'infected';
  cell.infectedAtTick = tickCount;
}

function roadWeight(road: string): number {
  switch (road) {
    case 'highway': return 3;
    case 'high':    return 2;
    case 'medium':  return 1;
    default:        return 0;
  }
}

function hasTransit(cell: SimCell): boolean {
  return roadWeight(cell.roads) >= 2;
}

// Cell status thresholds
// A cell with ANY living zombie is never 'clean' — that status means untouched.
function deriveCellStatus(zombie: number, susceptible: number, population: number): CellStatus {
  if (population <= 0) return 'abandoned';

  if (zombie <= 0) {
    const survivorRatio = susceptible / population;
    return survivorRatio < 0.05 ? 'abandoned' : 'clean';
  }

  const zombieRatio = zombie / population;
  if (zombieRatio > 0.6) return 'overrun';
  return 'infected';
}

// End condition — worker only enforces the city-wide hard caps.
// Personal verdict (user cell overrun) is triggered separately by the main thread.
function isSimulationOver(): boolean {
  // Hard ceiling — gives infection time to reach far-away users at 1× speed
  if (tickCount >= 220) return true;

  // Minimum run time — ALL sound layers need time to cross-fade in
  // Air-raid begins at 20% overrun; city needs ~60 ticks to get there
  if (tickCount < 65) return false;

  let overrunCells = 0;
  let totalCells   = 0;

  for (const cell of grid.values()) {
    totalCells++;
    if (cell.status === 'overrun' || cell.status === 'abandoned') overrunCells++;
  }

  // City 80%+ fallen — simulation is over regardless of user status
  return totalCells > 0 && overrunCells / totalCells >= 0.80;
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

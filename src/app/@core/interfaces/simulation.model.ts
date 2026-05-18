export type ZombieVariant  = 'standard' | 'fast' | 'horde';
export type CellStatus     = 'clean' | 'infected' | 'overrun' | 'abandoned';

export interface SimCell {
  cellId:        string;
  center:        [number, number];
  population:    number;
  susceptible:   number;
  infected:      number;
  zombie:        number;
  dead:          number;
  status:        CellStatus;
  landUse:       string;
  roads:         string;
  infectedAtTick?: number;
}

export interface SimStats {
  totalSurvivors:  number;
  totalInfected:   number;
  totalZombie:     number;
  totalDead:       number;
  survivalRate:    number;
  cityOverrunPct:  number;
  hoursElapsed:    number;
}

export interface TickResult {
  updatedCells: SimCell[];
  stats:        SimStats;
  tick:         number;
}

// Messages FROM main thread TO worker
export type WorkerMessage =
  | { type: 'INIT';      payload: { grid: SimCell[]; variant: ZombieVariant; seed: number; patientZeroCell: string } }
  | { type: 'TICK' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'TERMINATE' };

// Messages FROM worker TO main thread
export type WorkerResponse =
  | { type: 'INIT_COMPLETE' }
  | { type: 'TICK_RESULT'; payload: TickResult }
  | { type: 'SIM_ENDED';   payload: SimStats };

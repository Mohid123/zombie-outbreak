export const statusConstant = {
  idle:        'idle',
  configuring: 'configuring',
  running:     'running',
  paused:      'paused',
  ended:       'ended',
} as const;

export const tickSpeedConstant = {
  '1x':  1000,
  '2x':  500,
  '5x':  200,
  '10x': 100,
} as const;

export const variantType = {
  standard: 'standard',
  fast:     'fast',
  horde:    'horde',
} as const;

export type StatusConstant = (typeof statusConstant)[keyof typeof statusConstant];
export type TickSpeed      = (typeof tickSpeedConstant)[keyof typeof tickSpeedConstant];
export type VariantType    = (typeof variantType)[keyof typeof variantType];

// App phases
export type AppPhase = 'intro' | 'city-select' | 'quiz' | 'simulation';

// Simulation sub-phases (inside the map screen)
export type SimPhase = 'placing-pz' | 'placing-user' | 'running' | 'verdict';

// Escape window status
export type EscapeStatus = 'open' | 'flee' | 'closing' | 'closed' | 'unknown';

// Survival outcome
export type SurvivalOutcome =
  | 'survived_hero'
  | 'survived_lucky'
  | 'survived_barely'
  | 'turned'
  | 'died_fighting'
  | 'patient_zero_irony';

// City config
export interface CityConfig {
  id:          string;
  displayName: string;
  jsonFile:    string;
  center:      [number, number];
  country:     string;
  flag:        string;
  population:  string;
  description: string;
}

export const CITY_CONFIGS: CityConfig[] = [
  {
    id: 'newyork', displayName: 'New York', jsonFile: '/newyork.json',
    center: [-74.006, 40.7128], country: 'USA', flag: '🇺🇸',
    population: '8.3M', description: 'The city that never sleeps — or runs.',
  },
  {
    id: 'london', displayName: 'London', jsonFile: '/london.json',
    center: [-0.1278, 51.5074], country: 'UK', flag: '🇬🇧',
    population: '9.0M', description: 'Keep calm and evacuate.',
  },
  {
    id: 'lahore', displayName: 'Lahore', jsonFile: '/lahore.json',
    center: [74.3587, 31.5204], country: 'Pakistan', flag: '🇵🇰',
    population: '13.1M', description: 'Density is the enemy. Speed is survival.',
  },
  {
    id: 'tokyo', displayName: 'Tokyo', jsonFile: '/tokyo.json',
    center: [139.6917, 35.6895], country: 'Japan', flag: '🇯🇵',
    population: '13.9M', description: 'Orderly evacuation. For the first hour.',
  },
];

// User profile
export interface UserProfile {
  fitnessLevel:    'couch' | 'average' | 'athlete';
  hasVehicle:      boolean;
  hasBike:         boolean;
  buildingType:    'apartment' | 'house' | 'office' | 'rural';
  socialBehaviour: 'loner' | 'social' | 'leader';
  preparedness:    'none' | 'some' | 'prepper';
}

export interface cityEntity {
  name:            string;
  displayName:     string;
  center:          [number, number];
  bbox:            [number, number, number, number];
  totalPopulation: number;
}

export interface userProfileEntity {
  city:            cityEntity;
  fitness:         string;
  vehicle:         boolean;
  buildingType:    string;
  socialBehavior:  string;
  preparedness:    string;
}

export const statusConstant = {
  idle: 'idle',
  configuring: 'configuring',
  running: 'running',
  paused: 'paused',
  ended: 'ended',
} as const;

export const tickSpeedConstant = {
  '1x': 1000,
  '2x': 500,
  '5x': 200,
  '10x': 100,
} as const;

export const variantType = {
  standard: 'standard',
  fast: 'fast',
  horde: 'horde',
} as const;

export interface cityEntity {
    name: string;
    displayName: string;
    center: [number, number];
    bbox: [number, number, number, number];
    totalPopulation: number;
}

export type StatusConstant = (typeof statusConstant)[keyof typeof statusConstant];

export type TickSpeed = (typeof tickSpeedConstant)[keyof typeof tickSpeedConstant];

export type VariantType = (typeof variantType)[keyof typeof variantType];

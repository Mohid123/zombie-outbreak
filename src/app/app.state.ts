import { Injectable, signal } from '@angular/core';
import {
  cityEntity,
  StatusConstant,
  statusConstant,
  TickSpeed,
  tickSpeedConstant,
  VariantType,
  variantType,
} from './@core/interfaces/state.interface';

@Injectable({
  providedIn: 'root',
})
export class AppState {
  readonly status = signal<StatusConstant>(statusConstant.idle);
  readonly tick = signal<number>(0);
  readonly tickSpeed = signal<TickSpeed>(tickSpeedConstant['1x']);
  readonly variant = signal<VariantType>(variantType.standard);

  // City and Geography
  readonly selectedCity = signal<cityEntity | null>(null);
  readonly patientZero = signal<[number, number] | null>(null);
  readonly patientZeroLabel = signal<string>('');

  setStatus(s: StatusConstant) {
    this.status.set(s);
  }
  setVariant(v: VariantType) {
    this.variant.set(v);
  }
  setSpeed(n: TickSpeed) {
    this.tickSpeed.set(n);
  }
  incrementTick() {
    this.tick.update((t) => t + 1);
  }
}

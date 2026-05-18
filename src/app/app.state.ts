import { Injectable, signal, computed } from '@angular/core';
import { Subject } from 'rxjs';
import {
  cityEntity,
  StatusConstant,
  statusConstant,
  TickSpeed,
  tickSpeedConstant,
  userProfileEntity,
  VariantType,
  variantType,
} from './@core/interfaces/state.interface';
import { SimCell, SimStats, TickResult } from './@core/interfaces/simulation.model';

@Injectable({ providedIn: 'root' })
export class AppState {
  //Simulation status 
  readonly status = signal<StatusConstant>(statusConstant.idle);
  readonly tick = signal<number>(0);
  readonly tickSpeed = signal<TickSpeed>(tickSpeedConstant['1x']);
  readonly variant = signal<VariantType>(variantType.standard);

  // City and geography
  readonly selectedCity = signal<cityEntity | null>(null);
  readonly patientZero = signal<[number, number] | null>(null);
  readonly patientZeroLabel = signal<string>('');
  readonly patientZeroCell = signal<string | null>(null); // H3 cell ID

  //User
  readonly userProfile = signal<userProfileEntity | null>(null);

  //Simulation stats 
  readonly totalSurvivors = signal<number>(0);
  readonly totalInfected = signal<number>(0);
  readonly totalZombie = signal<number>(0);
  readonly totalDead = signal<number>(0);
  readonly cityOverrunPct = signal<number>(0);
  readonly hoursElapsed = signal<number>(0);

  //Computed signals
  readonly survivalRate = computed(() => {
    const city = this.selectedCity();
    if (!city || city.totalPopulation === 0) return 0;
    return this.totalSurvivors() / city.totalPopulation;
  });

  readonly isRunning = computed(() => this.status() === statusConstant.running);
  readonly isEnded = computed(() => this.status() === statusConstant.ended);
  readonly isIdle = computed(() => this.status() === statusConstant.idle);

  //RxJS streams — for event-shaped data
  // Components subscribe to these for map/deck updates
  readonly tickResult$ = new Subject<TickResult>();
  readonly simEnded$ = new Subject<SimStats>();

  //The grid — too large for a signal, mutated directly 
  readonly grid = new Map<string, SimCell>();

  //Mutators
  setStatus(s: StatusConstant) {
    this.status.set(s);
  }
  setVariant(v: VariantType) {
    this.variant.set(v);
  }
  setSpeed(n: TickSpeed) {
    this.tickSpeed.set(n);
  }
  setSelectedCity(c: cityEntity | null) {
    this.selectedCity.set(c);
  }
  setPatientZero(p: [number, number]) {
    this.patientZero.set(p);
  }
  setPatientZeroLabel(l: string) {
    this.patientZeroLabel.set(l);
  }
  setPatientZeroCell(id: string) {
    this.patientZeroCell.set(id);
  }
  setUserProfile(u: userProfileEntity) {
    this.userProfile.set(u);
  }
  incrementTick() {
    this.tick.update((t) => t + 1);
  }

  updateStats(stats: SimStats): void {
    this.totalSurvivors.set(Math.round(stats.totalSurvivors));
    this.totalInfected.set(Math.round(stats.totalInfected));
    this.totalZombie.set(Math.round(stats.totalZombie));
    this.totalDead.set(Math.round(stats.totalDead));
    this.cityOverrunPct.set(stats.cityOverrunPct);
    this.hoursElapsed.set(stats.hoursElapsed);
  }

  resetState(): void {
    this.status.set(statusConstant.idle);
    this.tick.set(0);
    this.patientZero.set(null);
    this.patientZeroLabel.set('');
    this.patientZeroCell.set(null);
    this.totalSurvivors.set(0);
    this.totalInfected.set(0);
    this.totalZombie.set(0);
    this.totalDead.set(0);
    this.cityOverrunPct.set(0);
    this.hoursElapsed.set(0);
    this.grid.clear();
  }
}

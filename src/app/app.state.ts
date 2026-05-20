import { Injectable, signal, computed } from '@angular/core';
import { Subject } from 'rxjs';
import {
  StatusConstant,
  statusConstant,
  TickSpeed,
  tickSpeedConstant,
  VariantType,
  variantType,
  AppPhase,
  SimPhase,
  EscapeStatus,
  SurvivalOutcome,
  CityConfig,
  UserProfile,
  cityEntity,
  userProfileEntity,
} from './@core/interfaces/state.interface';
import { SimCell, SimStats, TickResult } from './@core/interfaces/simulation.model';

@Injectable({ providedIn: 'root' })
export class AppState {
  readonly appPhase = signal<AppPhase>('intro');
  readonly simPhase = signal<SimPhase>('placing-user');

  readonly status = signal<StatusConstant>(statusConstant.idle);
  readonly tick = signal<number>(0);
  readonly tickSpeed = signal<TickSpeed>(tickSpeedConstant['1x']);
  readonly variant = signal<VariantType>(variantType.standard);

  readonly selectedCity = signal<cityEntity | null>(null);
  readonly selectedCityConfig = signal<CityConfig | null>(null);

  readonly patientZeroCoord = signal<[number, number] | null>(null);
  readonly patientZeroCell = signal<string | null>(null);

  readonly userProfile = signal<UserProfile | null>(null);
  readonly userCell = signal<string | null>(null);
  readonly userCoord = signal<[number, number] | null>(null);

  readonly escapeStatus = signal<EscapeStatus>('unknown');
  readonly escapeTicksLeft = signal<number>(-1);
  readonly userInfectedTick = signal<number>(-1);
  readonly userOverrunTick = signal<number>(-1);

  readonly survivalScore = signal<number>(0);
  readonly survivalOutcome = signal<SurvivalOutcome | null>(null);

  // Live stats — updated every tick while sim runs
  readonly totalSurvivors = signal<number>(0);
  readonly totalInfected = signal<number>(0);
  readonly totalZombie = signal<number>(0);
  readonly totalDead = signal<number>(0);
  readonly cityOverrunPct = signal<number>(0);
  readonly hoursElapsed = signal<number>(0);

  // Frozen snapshot written once when SIM_ENDED fires.
  // VerdictComponent reads from these so the numbers never drift after the sim stops.
  readonly finalSurvivors = signal<number>(0);
  readonly finalInfected = signal<number>(0);
  readonly finalZombie = signal<number>(0);
  readonly finalDead = signal<number>(0);
  readonly finalOverrunPct = signal<number>(0);
  readonly finalHours = signal<number>(0);
  readonly finalTick = signal<number>(0);
  readonly finalStats = signal<SimStats | null>(null);

  readonly isReplay = signal<boolean>(false);
  readonly cityCenter = signal<[number, number] | null>(null);
  readonly seed = signal<number>(0);

  readonly isRunning = computed(() => this.status() === statusConstant.running);
  readonly isEnded = computed(() => this.status() === statusConstant.ended);
  readonly isIdle = computed(() => this.status() === statusConstant.idle);

  readonly tickResult$ = new Subject<TickResult>();
  readonly simEnded$ = new Subject<SimStats>();

  readonly grid = new Map<string, SimCell>();

  setAppPhase(p: AppPhase) {
    this.appPhase.set(p);
  }
  setSimPhase(p: SimPhase) {
    this.simPhase.set(p);
  }
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
  setSelectedCityConfig(c: CityConfig | null) {
    this.selectedCityConfig.set(c);
  }
  setPatientZeroCoord(p: [number, number]) {
    this.patientZeroCoord.set(p);
  }
  setPatientZeroCell(id: string) {
    this.patientZeroCell.set(id);
  }
  setUserProfile(p: UserProfile) {
    this.userProfile.set(p);
  }
  setUserCell(id: string) {
    this.userCell.set(id);
  }
  setUserCoord(c: [number, number]) {
    this.userCoord.set(c);
  }
  setEscapeStatus(s: EscapeStatus) {
    this.escapeStatus.set(s);
  }
  setEscapeTicksLeft(n: number) {
    this.escapeTicksLeft.set(n);
  }
  setUserInfectedTick(t: number) {
    this.userInfectedTick.set(t);
  }
  setUserOverrunTick(t: number) {
    this.userOverrunTick.set(t);
  }
  setSurvivalScore(n: number) {
    this.survivalScore.set(n);
  }
  setSurvivalOutcome(o: SurvivalOutcome) {
    this.survivalOutcome.set(o);
  }
  incrementTick() {
    this.tick.update((t) => t + 1);
  }
  setIsReplay(b: boolean) {
    this.isReplay.set(b);
  }
  setCityCenter(center: [number, number]) {
    this.cityCenter.set(center);
  }
  setSeed(seed: number) {
    this.seed.set(seed);
  }

  updateStats(s: SimStats): void {
    this.totalSurvivors.set(Math.round(s.totalSurvivors));
    this.totalInfected.set(Math.round(s.totalInfected));
    this.totalZombie.set(Math.round(s.totalZombie));
    this.totalDead.set(Math.round(s.totalDead));
    this.cityOverrunPct.set(s.cityOverrunPct);
    this.hoursElapsed.set(s.hoursElapsed);
  }

  // Called once by SimulationService when SIM_ENDED arrives.
  // Writes a frozen copy so VerdictComponent gets stable values.
  freezeStats(s: SimStats, tick: number): void {
    this.finalSurvivors.set(Math.round(s.totalSurvivors));
    this.finalInfected.set(Math.round(s.totalInfected));
    this.finalZombie.set(Math.round(s.totalZombie));
    this.finalDead.set(Math.round(s.totalDead));
    this.finalOverrunPct.set(s.cityOverrunPct);
    this.finalHours.set(s.hoursElapsed);
    this.finalTick.set(tick);
    this.finalStats.set(s);
  }

  resetSimState(): void {
    this.status.set(statusConstant.idle);
    this.tick.set(0);
    this.patientZeroCoord.set(null);
    this.patientZeroCell.set(null);
    this.userCell.set(null);
    this.userCoord.set(null);
    this.escapeStatus.set('unknown');
    this.escapeTicksLeft.set(-1);
    this.userInfectedTick.set(-1);
    this.userOverrunTick.set(-1);
    this.survivalScore.set(0);
    this.survivalOutcome.set(null);
    this.totalSurvivors.set(0);
    this.totalInfected.set(0);
    this.totalZombie.set(0);
    this.totalDead.set(0);
    this.cityOverrunPct.set(0);
    this.hoursElapsed.set(0);
    this.finalSurvivors.set(0);
    this.finalInfected.set(0);
    this.finalZombie.set(0);
    this.finalDead.set(0);
    this.finalOverrunPct.set(0);
    this.finalHours.set(0);
    this.finalTick.set(0);
    this.finalStats.set(null);
    this.simPhase.set('placing-user');
    this.grid.clear();
  }

  resetState() {
    this.resetSimState();
  }
  setPatientZero(p: [number, number]) {
    this.patientZeroCoord.set(p);
  }
  setPatientZeroLabel(_l: string) {}
  setUserProfile2(_u: userProfileEntity) {}
}

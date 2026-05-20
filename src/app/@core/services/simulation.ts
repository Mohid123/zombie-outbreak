import { Injectable, inject, OnDestroy, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, Subscription, interval } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { AppState } from '../../app.state';
import {
  SimCell,
  SimStats,
  TickResult,
  WorkerMessage,
  WorkerResponse,
} from '../interfaces/simulation.model';
import { statusConstant } from '../interfaces/state.interface';

@Injectable({ providedIn: 'root' })
export class SimulationService implements OnDestroy {
  private state = inject(AppState);
  private destroyRef = inject(DestroyRef);

  private worker!: Worker;
  private tickSubscription: Subscription | null = null;

  init(grid: SimCell[], seed: number): void {
    this.destroyWorker();

    this.worker = new Worker(new URL('../../calculations-worker.ts', import.meta.url), {
      type: 'module',
    });

    fromEvent<MessageEvent>(this.worker, 'message')
      .pipe(
        map((e) => e.data as WorkerResponse),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((msg) => this.handleWorkerMessage(msg));

    this.state.grid.clear();
    grid.forEach((cell) => this.state.grid.set(cell.cellId, cell));

    const message: WorkerMessage = {
      type: 'INIT',
      payload: {
        grid,
        variant: this.state.variant(),
        seed,
        patientZeroCell: this.state.patientZeroCell() ?? '',
      },
    };
    this.worker.postMessage(message);
  }

  start(): void {
    if (this.tickSubscription) this.tickSubscription.unsubscribe();

    this.state.setStatus(statusConstant.running);

    this.tickSubscription = interval(this.state.tickSpeed())
      .pipe(
        filter(() => this.state.isRunning()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.worker.postMessage({ type: 'TICK' } satisfies WorkerMessage);
      });
  }

  pause(): void {
    this.state.setStatus(statusConstant.paused);
    this.worker?.postMessage({ type: 'PAUSE' } satisfies WorkerMessage);
    this.tickSubscription?.unsubscribe();
    this.tickSubscription = null;
  }

  resume(): void {
    this.worker?.postMessage({ type: 'RESUME' } satisfies WorkerMessage);
    this.start();
  }

  setSpeed(speedMs: number): void {
    this.state.setSpeed(speedMs as any);
    if (this.state.isRunning()) {
      this.pause();
      this.resume();
    }
  }

  reset(): void {
    this.pause();
    this.destroyWorker();
    this.state.resetState();
  }

  private handleWorkerMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'INIT_COMPLETE': {
        if (!this.state.isRunning()) {
          this.state.setStatus(statusConstant.configuring);
        }
        break;
      }
      case 'TICK_RESULT': {
        this.applyTickResult(msg.payload);
        break;
      }
      case 'SIM_ENDED': {
        this.applySimEnd(msg.payload);
        break;
      }
    }
  }

  private applyTickResult(result: TickResult): void {
    // Stop processing ticks if the sim has already ended — in-flight TICK_RESULT
    // messages from the worker can arrive after SIM_ENDED and would overwrite the
    // frozen stats, causing the verdict numbers to keep changing
    if (this.state.isEnded()) return;

    result.updatedCells.forEach((cell) => {
      this.state.grid.set(cell.cellId, cell);
    });

    this.state.updateStats(result.stats);
    this.state.incrementTick();
    this.state.tickResult$.next(result);
  }

  private applySimEnd(stats: SimStats): void {
    // Freeze stats first so any concurrent TICK_RESULT that slips through
    // cannot overwrite them — freezeStats writes to separate final* signals
    this.state.freezeStats(stats, this.state.tick());

    this.state.updateStats(stats);
    this.state.setStatus(statusConstant.ended);
    this.state.simEnded$.next(stats);
    this.tickSubscription?.unsubscribe();
    this.tickSubscription = null;
  }

  private destroyWorker(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'TERMINATE' } satisfies WorkerMessage);
      this.worker.terminate();
    }
  }

  ngOnDestroy(): void {
    this.destroyWorker();
    this.tickSubscription?.unsubscribe();
  }
}

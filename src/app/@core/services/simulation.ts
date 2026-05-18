import { Injectable, inject, OnDestroy, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, Subscription, interval } from 'rxjs';
import { map, filter, tap } from 'rxjs/operators';
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

  // Initialise worker and load city grid
  init(grid: SimCell[], seed: number): void {
    this.destroyWorker();

    this.worker = new Worker(new URL('../../calculations-worker.ts', import.meta.url), {
      type: 'module',
    });

    // Wire worker messages → RxJS stream
    fromEvent<MessageEvent>(this.worker, 'message')
      .pipe(
        map((e) => e.data as WorkerResponse),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((msg) => this.handleWorkerMessage(msg));

    // Load grid into AppState
    this.state.grid.clear();
    grid.forEach((cell) => this.state.grid.set(cell.cellId, cell));

    // Send INIT to worker
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

  //Start tick loop
  start(): void {
    if (this.tickSubscription) this.tickSubscription.unsubscribe();

    this.state.setStatus(statusConstant.running);

    // RxJS interval drives the worker — one TICK message per interval
    this.tickSubscription = interval(this.state.tickSpeed())
      .pipe(
        filter(() => this.state.isRunning()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.worker.postMessage({ type: 'TICK' } satisfies WorkerMessage);
      });
  }

  // Pause
  pause(): void {
    this.state.setStatus(statusConstant.paused);
    this.worker?.postMessage({ type: 'PAUSE' } satisfies WorkerMessage);
    this.tickSubscription?.unsubscribe();
    this.tickSubscription = null;
  }

  // Resume
  resume(): void {
    this.worker?.postMessage({ type: 'RESUME' } satisfies WorkerMessage);
    this.start();
  }

  //Change speed — restart interval at new rate
  setSpeed(speedMs: number): void {
    this.state.setSpeed(speedMs as any);
    if (this.state.isRunning()) {
      this.pause();
      this.resume();
    }
  }

  // Reset everything
  reset(): void {
    this.pause();
    this.destroyWorker();
    this.state.resetState();
  }

  // Handle all messages coming back from the worker
  private handleWorkerMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'INIT_COMPLETE': {
        // Worker is ready — waiting for start() to be called
        this.state.setStatus(statusConstant.configuring);
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

  // Apply tick result to state and emit stream
  private applyTickResult(result: TickResult): void {
    // 1. Mutate grid directly — not a signal
    result.updatedCells.forEach((cell) => {
      this.state.grid.set(cell.cellId, cell);
    });

    // 2. Update stat signals
    this.state.updateStats(result.stats);
    this.state.incrementTick();

    // 3. Emit to RxJS stream — MapService and DeckGL subscribe here
    this.state.tickResult$.next(result);
  }

  //Simulation ended
  private applySimEnd(stats: SimStats): void {
    this.state.updateStats(stats);
    this.state.setStatus(statusConstant.ended);
    this.state.simEnded$.next(stats);
    this.tickSubscription?.unsubscribe();
    this.tickSubscription = null;
  }

  // Cleanup
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

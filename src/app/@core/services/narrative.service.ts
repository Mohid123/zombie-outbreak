import { Injectable, signal } from '@angular/core';
import { CellStatus } from '../interfaces/simulation.model';
import { EscapeStatus } from '../interfaces/state.interface';

export interface NarrativeMessage {
  id:        number;
  text:      string;
  category:  'status' | 'alert' | 'event' | 'personal';
  timestamp: number;
}

// Scripted event messages — fire once at a specific tick
const TICK_EVENTS: { tick: number; text: string }[] = [
  { tick:  1,  text: '⚠ OUTBREAK DETECTED. Government containment response: INADEQUATE.' },
  { tick:  4,  text: '📡 WHO issues LEVEL 4 alert. Civilian evacuation advised for affected zones.' },
  { tick:  8,  text: '🚨 Infection has crossed neighbourhood boundaries. Containment: FAILED.' },
  { tick: 15,  text: '🏥 All hospitals in affected area operating beyond capacity.' },
  { tick: 25,  text: '🚔 Martial law declared. Curfew in effect. Shoot-on-sight orders at city perimeter.' },
  { tick: 40,  text: '✈ International airspace closed. City in full lockdown. No evacuations.' },
  { tick: 55,  text: '📻 Automated emergency broadcast — all civilians shelter in place immediately.' },
  { tick: 70,  text: '📡 No official broadcast in 12 hours. All emergency channels silent.' },
  { tick: 90,  text: '💀 Last known survivor count: unreliable. City is considered lost.' },
];

// Contextual message pools by escape status
const MSGS_BY_STATUS: Record<EscapeStatus, string[]> = {
  open: [
    'Your neighbourhood is quiet. Too quiet.',
    'The 6am train didn\'t come. Or the 7am.',
    'News reports seem distant. Surely it won\'t reach here.',
    'Your neighbours are boarding windows. You think they\'re overreacting.',
    'Shops closed early today. Nobody seems to know why.',
    'Mobile networks are congested. Calls failing.',
    'A dog has been barking for three hours. No one answered the door.',
  ],
  flee: [
    'Someone on your street didn\'t come home last night.',
    'The supermarket shelves are empty. You should have left yesterday.',
    'Emergency services stopped responding to your area.',
    'The government is "monitoring the situation." You are not reassured.',
    'A neighbour left in a hurry. They didn\'t say goodbye.',
    'Your phone\'s emergency alert just lit up.',
    'There are sounds outside you can\'t explain.',
  ],
  closing: [
    'The power just flickered. It came back. For now.',
    'You can hear running in the corridor. Not jogging.',
    'The hospital is not accepting walk-ins. Or anyone.',
    'You found a note from a neighbour slipped under your door. It just says "GO NORTH."',
    'Military broadcasts have stopped. That is not a good sign.',
    'Last news update was 4 hours ago.',
  ],
  closed: [
    'The power went out. It didn\'t come back.',
    'You can hear them on the floor below.',
    'You have one decision left to make.',
    'The silence is worse than the screaming was.',
    'You are possibly the last person on this street.',
    'There is no one left to call.',
    'You found a photo on the ground. A family. You kept it.',
  ],
  unknown: [
    'Your neighbourhood is quiet. Too quiet.',
    'Shops closed early today. Nobody seems to know why.',
  ],
};

@Injectable({ providedIn: 'root' })
export class NarrativeService {
  readonly messages = signal<NarrativeMessage[]>([]);

  private nextId        = 0;
  private lastMsgTick   = -999;
  private firedEvents   = new Set<number>();
  private readonly MAX  = 6;
  private readonly GAP  = 7; // minimum ticks between non-event messages

  init(): void {
    this.messages.set([]);
    this.nextId      = 0;
    this.lastMsgTick = -999;
    this.firedEvents.clear();
  }

  push(text: string, category: NarrativeMessage['category'], tick: number): void {
    const msg: NarrativeMessage = { id: this.nextId++, text, category, timestamp: tick };
    this.messages.update(prev => {
      const next = [msg, ...prev];
      return next.length > this.MAX ? next.slice(0, this.MAX) : next;
    });
  }

  onTick(
    tick:           number,
    spreadCount:    number,
    overrunPct:     number,
    escapeStatus:   EscapeStatus,
  ): void {
    // 1. Scripted events always fire (they're rare and important)
    const evt = TICK_EVENTS.find(e => e.tick === tick && !this.firedEvents.has(e.tick));
    if (evt) {
      this.firedEvents.add(evt.tick);
      this.push(evt.text, 'event', tick);
      this.lastMsgTick = tick;
      return; // one message per tick max
    }

    // 2. Personal / status messages: respect minimum gap
    if (tick - this.lastMsgTick < this.GAP) return;

    // Only push a random message occasionally — not every gap
    const roll = Math.random();
    if (roll > 0.35) return; // ~35 % chance when the gap is met

    const pool = MSGS_BY_STATUS[escapeStatus] ?? MSGS_BY_STATUS.open;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const cat  = (escapeStatus === 'closed' || escapeStatus === 'closing')
      ? 'personal' : 'status';

    this.push(text, cat, tick);
    this.lastMsgTick = tick;
  }
}

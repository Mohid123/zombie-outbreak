import { Injectable } from '@angular/core';
import { UserProfile, SurvivalOutcome } from '../interfaces/state.interface';

export interface SurvivalResult {
  score:       number;
  outcome:     SurvivalOutcome;
  headline:    string;
  flavourText: string;
  probability: number;
  escaped:     boolean;
  escapeDetail: string;
}

// Flavour copy
const COPY: Record<SurvivalOutcome, { headline: string; flavours: string[] }> = {
  survived_hero: {
    headline: 'SURVIVED — HERO',
    flavours: [
      'You didn\'t just survive. You organised a convoy of 47 people to the highlands. They call you "the Colonel" now.',
      'You had a plan, you executed it, and you slept four hours last Tuesday. Totally fine.',
      'Your emergency kit lasted three weeks. You shared it. That was your biggest risk.',
    ],
  },
  survived_lucky: {
    headline: 'SURVIVED — LUCKY',
    flavours: [
      'You fled hours before your neighbourhood fell. Your car got you to the hills. You haven\'t slept in 11 days.',
      'You made three terrible decisions. All of them worked out. Don\'t think too hard about that.',
      'You survived by trusting a stranger with a truck. You still don\'t know their name.',
    ],
  },
  survived_barely: {
    headline: 'SURVIVED — BARELY',
    flavours: [
      'You\'re infected. Or immune. You\'re not sure. Neither are they. You\'re keeping your distance.',
      'You\'re alive but you no longer answer to your name. Some habits are hard to break.',
      'The bite probably wasn\'t deep enough. Probably.',
    ],
  },
  turned: {
    headline: 'TURNED',
    flavours: [
      'Day 3. You stopped checking your temperature. There wasn\'t a point anymore.',
      'You didn\'t turn violently. You just… drifted. Like falling asleep.',
      'The last human thought you had was "I should have left earlier." You were right.',
    ],
  },
  died_fighting: {
    headline: 'DIED FIGHTING',
    flavours: [
      'You went down in the lobby of your building with a fire extinguisher. Respect.',
      'Three hours. You bought everyone on your floor three hours. Some of them made it.',
      'You didn\'t run. That was your choice. We\'re not judging.',
    ],
  },
  patient_zero_irony: {
    headline: 'YOU WERE PATIENT ZERO',
    flavours: [
      'The outbreak started exactly where you live. The irony is not lost on us.',
      'You were Ground Zero. Congratulations — in a terrible, terrible way.',
      'This was always going to end this way. It started with you.',
    ],
  },
};

// Escape window in ticks (1 tick ≈ 1 simulation hour)
function escapeWindowTicks(p: UserProfile): number {
  let w = 0;
  // Fitness — reaction speed and stamina
  w += { couch: 1, average: 3, athlete: 5 }[p.fitnessLevel];
  // Transport — how fast you can actually leave
  w += p.hasVehicle ? 8 : p.hasBike ? 4 : 1;
  // Building — proximity to danger and ease of egress
  w += { rural: 8, house: 3, apartment: 0, office: -1 }[p.buildingType];
  // Preparedness — packed bag, planned route, stockpile
  w += { none: 0, some: 3, prepper: 7 }[p.preparedness];
  // Social — network warns you early / leader role
  w += { loner: 0, social: 1, leader: 3 }[p.socialBehaviour];
  return Math.max(1, w);
  // Range: 1 (worst) → 31 (best: athlete + car + rural + prepper + leader)
}

@Injectable({ providedIn: 'root' })
export class SurvivalService {

  /**
   * Full verdict calculation — combines quiz profile with actual escape timing.
   *
   * @param infectedTick  Tick when user's cell first became infected (-1 = never)
   * @param overrunTick   Tick when user's cell became overrun (-1 = never)
   * @param currentTick   Tick when verdict fired
   * @param cityOverrunPct  Final city overrun fraction (0–1)
   */
  calculate(
    profile:       UserProfile,
    isPatientZero: boolean,
    infectedTick:  number,
    overrunTick:   number,
    currentTick:   number,
    cityOverrunPct: number,
  ): SurvivalResult {
    if (isPatientZero) return this.build(0, 'patient_zero_irony', false, 'You were the source.');

    // Base score from quiz (max 100)
    let score = 0;
    score += { couch: 0, average: 14, athlete: 25 }[profile.fitnessLevel];
    score += profile.hasVehicle ? 20 : profile.hasBike ? 10 : 3;
    score += { apartment: 5, house: 15, rural: 20, office: 8 }[profile.buildingType];
    score += { loner: 7, social: 13, leader: 20 }[profile.socialBehaviour];
    score += { none: 0, some: 8, prepper: 15 }[profile.preparedness];

    // Escape timing modifier
    const window = escapeWindowTicks(profile);
    let escaped  = false;
    let escapeDetail = '';

    if (infectedTick === -1) {
      // User's cell was never infected — clean escape, best bonus
      escaped = true;
      score  += 18;
      escapeDetail = `Your area was never reached. You had ${window} hours of escape capacity — you never needed it.`;

    } else if (overrunTick === -1) {
      // Cell infected but never overrun — you were in the thick of it but escaped
      escaped = true;
      score  += 8;
      escapeDetail = `Your area was infected at hour ${infectedTick} but never fell. With ${window}h of escape window, you got out.`;

    } else {
      // Cell was overrun — did the user have time?
      const available   = overrunTick - infectedTick; // hours between infected and overrun
      const margin      = window - available;          // positive = had spare time, negative = ran out

      if (margin >= 6) {
        escaped = true;
        score  += 15;
        escapeDetail = `Infected at hour ${infectedTick}, overrun at hour ${overrunTick}. You had ${window}h to flee — ${margin}h to spare.`;
      } else if (margin >= 2) {
        escaped = true;
        score  += 5;
        escapeDetail = `Infected at hour ${infectedTick}, overrun at hour ${overrunTick}. You escaped with just ${margin} hour(s) to spare.`;
      } else if (margin >= -2) {
        // Razor thin — luck decides
        escaped = Math.random() > 0.5;
        score  += escaped ? 2 : -10;
        escapeDetail = escaped
          ? `You cut it extremely close. Your area fell ${Math.abs(margin)}h after you (theoretically) left.`
          : `You cut it too close. Your area fell before you could realistically get out.`;
      } else {
        escaped = false;
        score  -= 18;
        escapeDetail = `Your area fell at hour ${overrunTick}. Your escape window was ${window}h — you needed ${Math.abs(margin)} more.`;
      }
    }

    // City-wide context — harder city = worse odds for everyone
    const cityPenalty = Math.round(cityOverrunPct * 12);
    score = Math.max(0, Math.min(100, score - cityPenalty));

    const outcome = this.getOutcome(score, escaped);
    return this.build(score, outcome, escaped, escapeDetail);
  }

  private getOutcome(score: number, escaped: boolean): SurvivalOutcome {
    if (!escaped) {
      if (score >= 35) return 'survived_barely'; // infected but potentially immune
      if (score >= 18) return 'turned';
      return 'died_fighting';
    }
    if (score >= 78) return 'survived_hero';
    if (score >= 55) return 'survived_lucky';
    return 'survived_barely';
  }

  private build(
    score:        number,
    outcome:      SurvivalOutcome,
    escaped:      boolean,
    escapeDetail: string,
  ): SurvivalResult {
    const data    = COPY[outcome];
    const flavour = data.flavours[Math.floor(Math.random() * data.flavours.length)];
    const prob    = this.probabilityFor(outcome);
    return { score, outcome, headline: data.headline, flavourText: flavour, probability: prob, escaped, escapeDetail };
  }

  private probabilityFor(outcome: SurvivalOutcome): number {
    const ranges: Record<SurvivalOutcome, [number, number]> = {
      survived_hero:       [82, 99],
      survived_lucky:      [55, 81],
      survived_barely:     [30, 54],
      turned:              [10, 29],
      died_fighting:       [3,  9],
      patient_zero_irony:  [0,  0],
    };
    const [lo, hi] = ranges[outcome];
    return Math.round(lo + Math.random() * (hi - lo));
  }
}

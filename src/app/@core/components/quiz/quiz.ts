import {
  ChangeDetectionStrategy, Component, inject,
  OnInit, signal, computed,
} from '@angular/core';
import { Router } from '@angular/router';
import { AppState } from '../../../app.state';
import { AudioService } from '../../services/audio.service';
import { UserProfile } from '../../interfaces/state.interface';

interface QuizOption { label: string; emoji: string; value: string; }
interface QuizQuestion {
  id:       keyof UserProfile | '_vehicle';
  question: string;
  options:  QuizOption[];
}

const QUESTIONS: QuizQuestion[] = [
  {
    id: 'fitnessLevel',
    question: 'How often do you exercise?',
    options: [
      { emoji: '🛋️', label: "What's a gym?",         value: 'couch'   },
      { emoji: '🚶', label: 'Sometimes',              value: 'average' },
      { emoji: '💪', label: 'I could outrun a zombie', value: 'athlete' },
    ],
  },
  {
    id: '_vehicle',
    question: 'How do you get around?',
    options: [
      { emoji: '🚗', label: 'Car — always',         value: 'car'   },
      { emoji: '🚌', label: 'Public transport',     value: 'transit' },
      { emoji: '🚲', label: 'Bike life',            value: 'bike'  },
    ],
  },
  {
    id: 'buildingType',
    question: 'Where do you live?',
    options: [
      { emoji: '🏢', label: 'City apartment',   value: 'apartment' },
      { emoji: '🏠', label: 'Suburban house',   value: 'house'     },
      { emoji: '🌲', label: 'Rural / outside town', value: 'rural' },
      { emoji: '🏗️', label: 'Commercial / office', value: 'office' },
    ],
  },
  {
    id: 'socialBehaviour',
    question: 'Crisis hits. What do you do?',
    options: [
      { emoji: '🙈', label: 'Lock the door and hide',   value: 'loner'  },
      { emoji: '👥', label: 'Rally the neighbours',     value: 'social' },
      { emoji: '🎯', label: 'I was born for this',      value: 'leader' },
    ],
  },
  {
    id: 'preparedness',
    question: 'Emergency kit?',
    options: [
      { emoji: '❌', label: 'Haha what?',               value: 'none'   },
      { emoji: '🧰', label: 'Some canned goods',        value: 'some'   },
      { emoji: '🏕️', label: "I'm basically Bear Grylls", value: 'prepper' },
    ],
  },
];

@Component({
  selector: 'app-quiz',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="quiz-root">
      <div class="noise"></div>
      <div class="scanlines"></div>

      <div class="quiz-wrap">
        <!-- Progress bar -->
        <div class="progress-track">
          @for (q of questions; track q.id; let i = $index) {
            <div class="progress-dot" [class.done]="i < step()" [class.active]="i === step()"></div>
          }
        </div>
        <div class="progress-label">QUESTION {{ step() + 1 }} OF {{ questions.length }}</div>

        <!-- Question card -->
        <div class="q-card" [class.exiting]="exiting()">
          <div class="q-text">{{ current().question }}</div>
          <div class="options">
            @for (opt of current().options; track opt.value) {
              <button class="opt-btn" (click)="answer(opt.value)">
                <span class="opt-emoji">{{ opt.emoji }}</span>
                <span class="opt-label">{{ opt.label }}</span>
              </button>
            }
          </div>
        </div>

        <!-- Subject line -->
        <div class="subject-line">
          SUBJECT PROFILE — {{ cityName() }} — ASSESSMENT IN PROGRESS
        </div>
      </div>
    </div>
  `,
  styleUrl: './quiz.css',
})
export class QuizComponent implements OnInit {
  private router = inject(Router);
  private state  = inject(AppState);
  private audio  = inject(AudioService);

  readonly questions = QUESTIONS;
  readonly step      = signal(0);
  readonly exiting   = signal(false);

  private answers: Partial<UserProfile & { _vehicle: string }> = {};

  readonly current  = computed(() => QUESTIONS[this.step()]);
  readonly cityName = computed(() => this.state.selectedCityConfig()?.displayName ?? 'UNKNOWN');

  ngOnInit(): void {
    if (!this.state.selectedCityConfig()) {
      this.router.navigate(['/select']);
    }
  }

  answer(value: string): void {
    this.audio.click();
    const q = this.current();
    (this.answers as Record<string, string>)[q.id] = value;

    if (this.step() < QUESTIONS.length - 1) {
      this.exiting.set(true);
      setTimeout(() => {
        this.step.update(s => s + 1);
        this.exiting.set(false);
      }, 280);
    } else {
      this.finish();
    }
  }

  private finish(): void {
    const a = this.answers as Record<string, string>;
    const profile: UserProfile = {
      fitnessLevel:    (a['fitnessLevel'] as UserProfile['fitnessLevel']) ?? 'average',
      hasVehicle:      a['_vehicle'] === 'car',
      hasBike:         a['_vehicle'] === 'bike',
      buildingType:    (a['buildingType'] as UserProfile['buildingType']) ?? 'apartment',
      socialBehaviour: (a['socialBehaviour'] as UserProfile['socialBehaviour']) ?? 'social',
      preparedness:    (a['preparedness'] as UserProfile['preparedness']) ?? 'none',
    };
    this.state.setUserProfile(profile);
    this.audio.static(0.3);
    this.router.navigate(['/sim']);
  }
}

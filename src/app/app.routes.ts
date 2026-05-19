import { Routes } from '@angular/router';
import { IntroComponent }      from './@core/components/intro/intro';
import { CitySelectComponent } from './@core/components/city-select/city-select';
import { QuizComponent }       from './@core/components/quiz/quiz';
import { MapShell }            from './@core/components/map-shell/map-shell';
import { VerdictComponent }    from './@core/components/verdict/verdict';

export const routes: Routes = [
  { path: '',       component: IntroComponent      },
  { path: 'select', component: CitySelectComponent },
  { path: 'quiz',   component: QuizComponent       },
  { path: 'sim',    component: MapShell            },
  { path: 'verdict',component: VerdictComponent    },
  { path: '**',     redirectTo: ''                 },
];

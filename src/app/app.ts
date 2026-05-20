import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SharedOutbreakResolver } from './@core/resolver/share-resolver';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
  styles: [
    `
      :host {
        display: block;
        width: 100vw;
        height: 100vh;
      }
    `,
  ],
})
export class App {
  private replay = inject(SharedOutbreakResolver);
  *ngOnInit() {
    this.replay.checkAndReplay();
  }
}

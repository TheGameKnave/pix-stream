import { ChangeDetectionStrategy, Component, inject, isDevMode } from '@angular/core';
import { RouterModule } from '@angular/router';
import { UpdateService } from '@app/services/update.service';
import { ConnectivityService } from '@app/services/connectivity.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule],
})
export class AppComponent {
  readonly updateService = inject(UpdateService);
  protected readonly connectivity = inject(ConnectivityService);
  protected readonly isDevMode = isDevMode();
}

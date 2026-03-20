import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { inject } from '@angular/core';

@Component({
  selector: 'app-lightbox',
  templateUrl: 'lightbox.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule],
})
export class LightboxComponent {
  private readonly route = inject(ActivatedRoute);
  readonly photoId = this.route.snapshot.paramMap.get('id');
}

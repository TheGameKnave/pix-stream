import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from '@app/app.component';
import { appProviders } from 'src/main.config';

bootstrapApplication(AppComponent, {
  providers: appProviders,
}).catch((err) => console.error('Error bootstrapping application:', err));

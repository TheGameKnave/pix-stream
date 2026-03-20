import { Injectable } from '@angular/core';
import { ENVIRONMENT } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class LogService {
  log(message: string, object?: unknown): void {
    if (ENVIRONMENT.env !== 'production') {
      console.log(message, object ?? '');
    }
  }
}

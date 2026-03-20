import { importProvidersFrom, isDevMode, provideZonelessChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ServiceWorkerModule } from '@angular/service-worker';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from '@app/app.routing';

export const serverProviders = [
  provideZonelessChangeDetection(),
  importProvidersFrom(BrowserModule),
  provideHttpClient(withFetch()),
  provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
];

export const appProviders = [
  ...serverProviders,
  importProvidersFrom(
    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
  ),
];

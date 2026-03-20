import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes, RenderMode } from '@angular/ssr';
import { serverProviders } from './main.config';

const ssrProviders: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes([
      { path: 'admin', renderMode: RenderMode.Client },
      { path: '**', renderMode: RenderMode.Server },
    ])),
  ],
};

export const serverConfig = mergeApplicationConfig(
  { providers: serverProviders },
  ssrProviders,
);

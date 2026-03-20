import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';

export interface SeoConfig {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: string;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly meta = inject(Meta);
  private readonly titleService = inject(Title);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  updateTags(config: SeoConfig): void {
    if (config.title) {
      this.titleService.setTitle(config.title);
      this.meta.updateTag({ property: 'og:title', content: config.title });
    }
    if (config.description) {
      this.meta.updateTag({ name: 'description', content: config.description });
      this.meta.updateTag({ property: 'og:description', content: config.description });
    }
    if (config.image) {
      this.meta.updateTag({ property: 'og:image', content: config.image });
    }
    const url = config.url || (isPlatformBrowser(this.platformId) ? globalThis.location.href : this.router.url);
    this.meta.updateTag({ property: 'og:url', content: url });

    if (config.type) {
      this.meta.updateTag({ property: 'og:type', content: config.type });
    }
  }
}

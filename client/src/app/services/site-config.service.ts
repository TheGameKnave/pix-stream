import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export interface SiteConfig {
  title: string;
  description: string;
  accentColor: string;
  paletteMode: string;
  bgColor: string;
  fontDisplay: string;
  fontBody: string;
  nsfwBlurDefault: boolean;
}

@Injectable({ providedIn: 'root' })
export class SiteConfigService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly config = signal<SiteConfig | null>(null);
  readonly tags = signal<string[]>([]);
  readonly activeTags = signal<string[]>([]);
  readonly nsfwBlur = signal(this.loadNsfwPref());
  readonly hasNsfw = signal(false);
  readonly aboutOpen = signal(false);
  readonly adminSetupRequired = signal(false);
  private pendingSlugs: string[] = [];

  load(): void {
    this.http.get<SiteConfig>('/api/config').subscribe({
      next: (config) => {
        this.config.set(config);
        if (!this.isBrowser || localStorage.getItem('nsfw-blur') === null) {
          this.nsfwBlur.set(config.nsfwBlurDefault);
        }
      },
    });

    this.http.get<string[]>('/api/tags').subscribe({
      next: (tags) => {
        this.tags.set(tags);
        if (this.pendingSlugs.length) {
          this.resolveSlugsTags(this.pendingSlugs);
          this.pendingSlugs = [];
        }
      },
    });

    this.http.get<{ setupRequired: boolean }>('/api/auth/status').subscribe({
      next: (res) => this.adminSetupRequired.set(res.setupRequired),
    });
  }

  /** Set active tags from URL slugs — resolves against known tags when available. */
  setActiveFromSlugs(slugs: string[]): void {
    const known = this.tags();
    if (known.length) {
      this.resolveSlugsTags(slugs);
    } else {
      this.pendingSlugs = slugs;
    }
  }

  private resolveSlugsTags(slugs: string[]): void {
    const known = this.tags();
    const resolved = slugs.map(s => known.find(t => slugify(t) === s) ?? s);
    this.activeTags.set(resolved);
  }

  toggleNsfw(): void {
    const next = !this.nsfwBlur();
    this.nsfwBlur.set(next);
    if (this.isBrowser) {
      localStorage.setItem('nsfw-blur', JSON.stringify(next));
    }
  }

  private loadNsfwPref(): boolean {
    if (!this.isBrowser) return true;
    const stored = localStorage.getItem('nsfw-blur');
    if (stored !== null) return JSON.parse(stored);
    return true;
  }
}

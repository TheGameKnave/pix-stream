import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Meta, Title } from '@angular/platform-browser';
import { take, catchError, EMPTY } from 'rxjs';

export function slugify(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export interface SiteConfig {
  title: string;
  subtitle: string;
  headerColor: string;
  bgColor: string;
  fontBody: string;
  nsfwBlurDefault: boolean;
  enabledTags: string[];
  tagDisplayMode: 'nav' | 'dropdown';
  enableShare: boolean;
  enableDownload: boolean;
  enableQr: boolean;
  enableKiosk: boolean;
  flowDirection: 'rtl' | 'ltr' | 'ttb' | 'btt';
  flowSpeed: 'off' | 'low' | 'med' | 'high';
  contactEmail: string;
  pageHeadTitle: string;
  description: string;
  siteLogo: string;
  siteFavicon: string;
  watermark: string;
  sortOrder: 'date-desc' | 'date-asc' | 'random';
  homepageUrl: string;
  density: 'low' | 'med' | 'high';
}

@Injectable({ providedIn: 'root' })
export class SiteConfigService {
  private readonly http = inject(HttpClient);
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly config = signal<SiteConfig | null>(null);
  readonly allTags = signal<string[]>([]);
  readonly tags = signal<string[]>([]);
  readonly activeTags = signal<string[]>([]);
  readonly nsfwBlur = signal(this.loadNsfwPref());
  readonly hasNsfw = signal(false);
  readonly aboutOpen = signal(false);
  readonly adminSetupRequired = signal(false);
  readonly adminAuthenticated = signal(false);
  private pendingSlugs: string[] = [];

  load(): void {
    this.http.get<SiteConfig>('/api/config').pipe(take(1), catchError(() => EMPTY)).subscribe({
      next: (config) => {
        this.config.set(config);
        if (!this.isBrowser || localStorage.getItem('nsfw-blur') === null) {
          this.nsfwBlur.set(config.nsfwBlurDefault);
        }
        if (this.isBrowser) {
          this.applyTheme(config);
          this.titleService.setTitle(this.pageTitle());
          const desc = config.subtitle || config.description?.replace(/[#*_`[\]()]/g, '').slice(0, 160) || '';
          if (desc) {
            this.meta.updateTag({ name: 'description', content: desc });
            this.meta.updateTag({ property: 'og:description', content: desc });
          }
        }
        // Re-filter tags now that config (with enabledTags) is available
        if (this.allTags().length > 0) {
          this.applyTagFilter(this.allTags());
        }
      },
    });

    this.http.get<string[]>('/api/tags').pipe(take(1), catchError(() => EMPTY)).subscribe({
      next: (tags) => {
        this.allTags.set(tags);
        this.applyTagFilter(tags);
        if (this.pendingSlugs.length) {
          this.resolveSlugsTags(this.pendingSlugs);
          this.pendingSlugs = [];
        }
      },
    });

    this.http.get<{ setupRequired: boolean; authenticated: boolean }>('/api/auth/status').pipe(take(1), catchError(() => EMPTY)).subscribe({
      next: (res) => {
        this.adminSetupRequired.set(res.setupRequired);
        this.adminAuthenticated.set(res.authenticated);
      },
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

  saveConfig(partial: Partial<SiteConfig>): void {
    this.http.put<SiteConfig>('/api/config', partial).pipe(take(1)).subscribe({
      next: (config) => {
        this.config.set(config);
        this.applyTagFilter(this.allTags());
        if (this.isBrowser) {
          this.applyTheme(config);
          this.titleService.setTitle(this.pageTitle());
        }
      },
    });
  }

  private applyTagFilter(allTags: string[]): void {
    const enabled = this.config()?.enabledTags ?? [];
    this.tags.set(enabled.length > 0 ? allTags.filter(t => enabled.includes(t)) : allTags);
  }

  /**
   * Build a page title: SiteName [| context] [| pageHeadTitle] [| photo]
   * @param context  Middle segment: "Admin", "About", filter tags, etc. Omit for homepage/photo.
   * @param photo    Trailing segment: photo title or filename for lightbox view.
   */
  pageTitle(context?: string, photo?: string): string {
    const c = this.config();
    const parts = [c?.title || 'Pix Stream'];
    if (context) parts.push(context);
    if (c?.pageHeadTitle) parts.push(c.pageHeadTitle);
    if (photo) parts.push(photo);
    return parts.join(' | ');
  }

  private applyTheme(config: SiteConfig): void {
    const root = document.documentElement.style;
    root.setProperty('--color-header', config.headerColor);
    const headerText = this.contrastText(config.headerColor);
    root.setProperty('--color-header-text', headerText);
    this.applyHeaderGlow(config.headerColor, headerText, root);
    const [hH, sH] = this.hexToHsl(config.headerColor);
    const accentHsl = `hsl(${Math.round((hH + 180) % 360)}, ${Math.round(sH)}%, 45%)`;
    root.setProperty('--color-accent', accentHsl);
    root.setProperty('--color-accent-text', '#fafafa');
    root.setProperty('--color-accent-glow', 'none');
    const accentLink = this.hslOppositeHueInvertedL(config.headerColor);
    root.setProperty('--color-accent-link', accentLink);
    root.setProperty('--color-bg', this.clampBgLightness(config.bgColor));
    this.applyTextColor(config.bgColor, root);
    this.applyHeaderShadow(config.headerColor, config.bgColor, root);
    const font = `'${config.fontBody}', sans-serif`;
    root.setProperty('--font-display', font);
    root.setProperty('--font-body', font);
    this.loadFont(config.fontBody);
    this.applyFavicon(config.siteFavicon);
  }

  private applyFavicon(url: string): void {
    // Remove existing to force browser to re-fetch
    const old = document.querySelector('link[rel="icon"]');
    if (old) old.remove();

    const link = document.createElement('link');
    link.rel = 'icon';
    if (url) {
      const isIco = url.includes('.ico');
      link.type = isIco ? 'image/x-icon' : 'image/svg+xml';
      link.href = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    } else {
      link.type = 'image/svg+xml';
      link.href = 'favicon.svg';
    }
    document.head.appendChild(link);
  }

  /** Returns #222 for light backgrounds, #fafafa for dark. */
  private contrastText(hex: string): string {
    const [, , l] = this.hexToHsl(hex);
    return l > 55 ? '#222' : '#fafafa';
  }

  /** Set text color based on background lightness. Near-middle gets a glow (inverse of font color). */
  private applyTextColor(bgHex: string, root: CSSStyleDeclaration): void {
    const [, , l] = this.hexToHsl(bgHex);
    const cl = Math.max(20, Math.min(85, l)); // clamped lightness matches clampBgLightness
    const dark = cl <= 55;
    root.setProperty('--color-text', dark ? '#fafafa' : '#222');
    root.setProperty('--color-text-muted', dark ? '#999' : '#555');
    if (cl > 35 && cl < 65) {
      const glow = dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';
      root.setProperty('--color-text-shadow',
        `1px 0 4px ${glow}, -1px 0 4px ${glow}, 0 1px 4px ${glow}, 0 -1px 4px ${glow}`);
    } else {
      root.setProperty('--color-text-shadow', 'none');
    }
  }

  /** When header color is near-middle lightness, add a glow that's the inverse of the header font color. */
  private applyHeaderGlow(headerHex: string, headerText: string, root: CSSStyleDeclaration): void {
    const [, , l] = this.hexToHsl(headerHex);
    if (l > 35 && l < 65) {
      const glow = headerText === '#222' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
      root.setProperty('--color-header-glow',
        `1px 0 4px ${glow}, -1px 0 4px ${glow}, 0 1px 4px ${glow}, 0 -1px 4px ${glow}`);
      root.setProperty('--color-header-icon-shadow',
        `drop-shadow(0 0 3px ${glow})`);
    } else {
      root.setProperty('--color-header-glow', 'none');
      root.setProperty('--color-header-icon-shadow', 'none');
    }
  }

  /** Add a subtle shadow below the header when its lightness is close to the background's. */
  private applyHeaderShadow(headerHex: string, bgHex: string, root: CSSStyleDeclaration): void {
    const [, , hL] = this.hexToHsl(headerHex);
    const [, , bL] = this.hexToHsl(bgHex);
    const clampedBL = Math.max(20, Math.min(85, bL)); // matches clampBgLightness
    const diff = Math.abs(hL - clampedBL);
    if (diff < 15) {
      const dark = clampedBL <= 50;
      const shadowColor = dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.15)';
      root.setProperty('--header-shadow', `0 2px 8px ${shadowColor}`);
    } else {
      root.setProperty('--header-shadow', 'none');
    }
  }

  private hexToHsl(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    return [h * 360, s * 100, l * 100];
  }

  /** Clamp a hex color's HSL lightness to 20-85% so extreme values are tamed. */
  private clampBgLightness(hex: string): string {
    const [h, s, l] = this.hexToHsl(hex);
    const cl = Math.max(20, Math.min(85, l));
    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(cl)}%)`;
  }

  /** Return the opposite hue with inverted lightness (for link colors). */
  private hslOppositeHueInvertedL(hex: string): string {
    const [h, s, l] = this.hexToHsl(hex);
    return `hsl(${Math.round((h + 180) % 360)}, ${Math.round(s)}%, ${Math.round(100 - l)}%)`;
  }

  private loadedFonts = new Set<string>();

  private loadFont(family: string): void {
    if (this.loadedFonts.has(family)) return;
    this.loadedFonts.add(family);
    // Skip default font — already loaded via CSS
    if (family === 'Raleway') return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700&display=swap`;
    document.head.appendChild(link);
  }

  private loadNsfwPref(): boolean {
    if (!this.isBrowser) return true;
    const stored = localStorage.getItem('nsfw-blur');
    if (stored !== null) return JSON.parse(stored);
    return true;
  }
}

import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, isDevMode, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { isPlatformBrowser, Location } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { UpdateService } from '@app/services/update.service';
import { ConnectivityService } from '@app/services/connectivity.service';
import { SiteConfigService, slugify } from '@app/services/site-config.service';
import { GalleryStateService } from '@app/services/gallery-state.service';
import { HttpClient } from '@angular/common/http';
import { filter, take } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import QRCode from 'qrcode';
import { MarkdownComponent } from 'ngx-markdown';
import { ScrollIndicatorDirective } from '@app/directives/scroll-indicator.directive';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, MarkdownComponent, ScrollIndicatorDirective],
})
export class AppComponent {
  readonly updateService = inject(UpdateService);
  protected readonly connectivity = inject(ConnectivityService);
  protected readonly galleryState = inject(GalleryStateService);
  protected readonly isDevMode = isDevMode();
  protected readonly siteConfig = inject(SiteConfigService);
  protected readonly showHeader = signal(true);
  protected readonly onAdminPage = signal(false);
  protected readonly showInfo = this.siteConfig.aboutOpen;
  protected readonly tagDropdownOpen = signal(false);
  protected readonly aboutDescription = computed(() => {
    return this.siteConfig.config()?.description || '';
  });

  protected readonly instructionsMd = computed(() => {
    const tagCount = this.siteConfig.tags().length;
    const lines = [
      '**Scroll**, **arrow key** or **swipe** to explore the stream. **Click** / **tap** a photo to view it full size, then use **arrow keys** or **swipe** to navigate. Press **Esc** or **click** / **tap** to close.',
    ];
    if (tagCount > 5) {
      lines.push('Use the **filter** to browse by tag.');
    } else if (tagCount > 0) {
      lines.push('Use the **tags** in the header to browse.');
    }
    return lines.join(' ');
  });
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly titleService = inject(Title);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly headerRef = viewChild<ElementRef<HTMLElement>>('headerEl');
  private headerRo?: ResizeObserver;
  private urlBeforeAbout = '/';

  constructor() {
    this.siteConfig.load();

    const updateFromUrl = (url: string) => {
      this.showHeader.set(!url.startsWith('/kiosk'));
      this.onAdminPage.set(url.startsWith('/admin'));
      this.siteConfig.aboutOpen.set(url === '/about');
      if (url.startsWith('/admin')) {
        this.siteConfig.activeTags.set([]);
      }
    };
    updateFromUrl(this.router.url);

    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      updateFromUrl(e.url);
    });

    // Auto-open about dialog when admin setup is needed (skip on admin route)
    effect(() => {
      if (this.siteConfig.adminSetupRequired() && !this.router.url.startsWith('/admin')) {
        this.openAbout();
      }
    });

    afterNextRender(() => {
      const onDocClick = (e: MouseEvent) => {
        if (!this.tagDropdownOpen()) return;
        const t = e.target as HTMLElement;
        if (t.closest('.tag-dropdown-menu') || t.closest('.tag-dropdown-toggle')) return;
        this.tagDropdownOpen.set(false);
      };
      document.addEventListener('click', onDocClick, true);
      this.destroyRef.onDestroy(() => document.removeEventListener('click', onDocClick, true));
    });

    if (this.isBrowser) {
      effect(() => {
        const ref = this.headerRef();
        this.headerRo?.disconnect();
        if (ref) {
          const el = ref.nativeElement;
          const update = () => document.documentElement.style.setProperty('--header-height', el.offsetHeight + 'px');
          this.headerRo = new ResizeObserver(update);
          this.headerRo.observe(el);
          update();
        } else {
          document.documentElement.style.setProperty('--header-height', '0px');
        }
      });

      // Scroll active nav tag into view when tags render
      effect(() => {
        const tags = this.siteConfig.activeTags();
        if (!tags.length) return;
        // Defer to allow DOM to render
        requestAnimationFrame(() => {
          const active = document.querySelector('.tag-nav .tag-filter.active') as HTMLElement;
          active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });
      });
    }
  }

  toggleDropdown(): void {
    this.tagDropdownOpen.update(v => !v);
  }

  /** Nav mode: singular select — click swaps the active tag */
  selectNavTag(tag: string): void {
    const current = this.siteConfig.activeTags();
    const onGallery = !this.router.url.startsWith('/admin');
    if (current.includes(tag)) {
      this.siteConfig.activeTags.set([]);
      if (onGallery) this.location.replaceState('/');
      else this.router.navigateByUrl('/');
    } else {
      this.siteConfig.activeTags.set([tag]);
      const url = '/' + slugify(tag);
      if (onGallery) this.location.replaceState(url);
      else this.router.navigateByUrl(url);
    }
  }

  /** Dropdown mode: multi-select toggle */
  toggleFilterTag(tag: string): void {
    const current = this.siteConfig.activeTags();
    if (current.includes(tag)) {
      const next = current.filter(t => t !== tag);
      this.siteConfig.activeTags.set(next);
      this.location.replaceState(next.length ? '/' + next.map(slugify).join('+') : '/');
    } else {
      const next = [...current, tag];
      this.siteConfig.activeTags.set(next);
      this.location.replaceState('/' + next.map(slugify).join('+'));
    }
  }

  goHome(): void {
    this.siteConfig.activeTags.set([]);
    if (this.router.url.startsWith('/admin')) {
      this.router.navigateByUrl('/');
    } else {
      this.location.replaceState('/');
    }
  }

  openAbout(): void {
    if (this.showInfo()) return;
    this.urlBeforeAbout = this.location.path() || '/';
    this.location.replaceState('/about');
    this.showInfo.set(true);
    this.titleService.setTitle(this.siteConfig.pageTitle('About'));
  }

  closeAbout(): void {
    const restoreTo = this.urlBeforeAbout || '/';
    this.showInfo.set(false);
    this.location.replaceState(restoreTo);
    const tags = this.siteConfig.activeTags();
    this.titleService.setTitle(this.siteConfig.pageTitle(tags.length ? tags.join(' + ') : undefined));
  }

  async shareSite(): Promise<void> {
    const url = window.location.href;
    const title = this.siteConfig.config()?.title || 'Pix Stream';
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(url); } catch { /* failed */ }
  }

  async showQr(): Promise<void> {
    const url = window.location.href;
    const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });

    const overlay = document.createElement('div');
    overlay.className = 'qr-overlay';
    overlay.addEventListener('click', () => overlay.remove());

    const panel = document.createElement('div');
    panel.className = 'qr-panel';

    const qrImg = document.createElement('img');
    qrImg.src = dataUrl;
    qrImg.alt = 'QR Code';
    qrImg.style.cssText = 'display:block; width:200px; height:200px; border-radius:4px;';

    const label = document.createElement('p');
    label.textContent = 'Scan to visit';
    label.style.cssText = 'margin-top:0.75rem; color:var(--color-text-muted); font-size:0.8rem; text-align:center;';

    panel.appendChild(qrImg);
    panel.appendChild(label);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  adminLogout(): void {
    this.http.post('/api/auth/logout', {}).pipe(take(1)).subscribe({
      next: () => {
        this.siteConfig.adminAuthenticated.set(false);
        this.router.navigateByUrl('/');
      },
    });
  }
}

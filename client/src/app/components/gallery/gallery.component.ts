import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SeoService } from '@app/services/seo.service';
import { SiteConfigService, slugify } from '@app/services/site-config.service';
import { ConnectivityService } from '@app/services/connectivity.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import gsap from 'gsap';
import QRCode from 'qrcode';
import { GalleryStateService, FloatingImage, ImageEntry, ManifestResponse } from '@app/services/gallery-state.service';

let _Observer: any = null;

async function loadObserver(): Promise<void> {
  if (_Observer) return;
  const mod = await import('gsap/dist/Observer.js' as string);
  _Observer = mod.Observer || mod.default?.Observer || mod.default;
  if (_Observer) gsap.registerPlugin(_Observer);
}

const MAX_ROTATION = 15;
let _nextCardUid = 1;

/** Which column indices should be materialized for a given camera offset. */
export function visibleColRange(
  offset: number, vw: number, bufferMargin: number,
  gridOrigin: number, colSpacing: number,
): [number, number] {
  const leftEdge = offset - bufferMargin;
  const rightEdge = offset + vw + bufferMargin;
  const minCol = Math.floor((leftEdge - gridOrigin) / colSpacing);
  const maxCol = Math.ceil((rightEdge - gridOrigin) / colSpacing);
  return [minCol, maxCol];
}

/** Collect entry IDs from cards within ±proximity columns of targetCol. */
export function nearbyIds(
  cards: FloatingImage[], targetCol: number,
  gridOrigin: number, colSpacing: number, proximity: number,
  vertical = false,
): Set<string> {
  const ids = new Set<string>();
  for (const c of cards) {
    const pos = vertical ? c.y + c.h / 2 : c.x + c.w / 2;
    const cardCol = Math.round((pos - gridOrigin) / colSpacing);
    if (Math.abs(cardCol - targetCol) <= proximity) {
      ids.add(c.entry.id);
    }
  }
  return ids;
}

/** Determine cross-axis lane count based on aspect ratio of the viewport. */
export function laneCount(vw: number, vh: number): number {
  const ratio = vw / vh;
  if (ratio > 1.3) return 5;  // wide / landscape monitor
  if (ratio > 0.8) return 7;  // roughly square
  return 9;                    // tall / portrait
}

export function buildShadow(z: number): string {
  const offsetY = 2 + z * 10;
  const blur = 4 + z * 20;
  const spread = z * 4;
  const opacity = 0.2 + z * 0.3;
  return `0 ${offsetY}px ${blur}px ${spread}px rgba(0,0,0,${opacity})`;
}

export function makeCard(entry: ImageEntry, x: number, row: number, cellH: number, targetArea: number): FloatingImage {
  const aspect = entry.width && entry.height ? entry.width / entry.height : 1;
  const w = Math.sqrt(targetArea * aspect);
  const h = w / aspect;
  // Center in the cell, then jitter. Jitter is gaussian-ish (average of 2 randoms)
  // to keep most cards near center while allowing occasional outliers.
  const jitter = ((Math.random() + Math.random()) / 2 - 0.5) * cellH * 0.35;
  const y = row * cellH + cellH * 0.5 - h * 0.5 + jitter;
  const rotation = (Math.random() - 0.5) * 2 * MAX_ROTATION;
  const z = Math.random();
  return { uid: _nextCardUid++, entry, x, y, w, h, rotation, z, zIndex: Math.round(z * 100), shadow: buildShadow(z) };
}

@Component({
  selector: 'app-gallery',
  templateUrl: 'gallery.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly seo = inject(SeoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly state = inject(GalleryStateService);
  readonly siteConfig = inject(SiteConfigService);
  readonly connectivity = inject(ConnectivityService);

  readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  readonly empty = signal(false);
  readonly cards = signal<FloatingImage[]>([]);
  readonly loading = signal(true);

  // NSFW prompt state
  readonly nsfwPromptOpen = signal(false);

  // Lightbox state
  readonly lightboxOpen = signal(false);
  readonly lightboxImage = signal<FloatingImage | null>(null);
  private riverPaused = false;
  private lightboxEl: HTMLElement | null = null;
  private lightboxSourceCard: HTMLElement | null = null;
  private urlBeforeLightbox = '/';
  private lightboxControls: HTMLElement | null = null;
  private qrOverlay: HTMLElement | null = null;
  private displacedCards: { el: HTMLElement; dx: number; dy: number }[] = [];
  private lightboxOrder: { card: FloatingImage; cardIndex: number }[] = [];
  private lightboxOrderIdx = -1;
  private lightboxNavigating = false;

  /*
   * Coordinate system:
   * - Cards have world-space x,y positions (y is screen-relative, x is world-relative)
   * - `offset` = camera position in world space
   * - Container has translateX(-offset), so screen_x = card.x - offset
   * - Flow L→R: offset DECREASES over time (camera moves left, images appear to move right)
   * - A card is on-screen when: offset - margin < card.x < offset + vw + margin
   * - When card.x - offset > vw + margin → card exited right → recycle to left
   * - When card.x + card.w - offset < -margin → card exited left → recycle to right
   */
  private offset = 0;
  private baseSpeed = -0.5;
  private userSpeed = 0;
  private vertical = false; // true for ttb/btt flow
  private primaryLen = 0;
  private rafId = 0;
  private pollTimer = 0;
  private observer: any = null;
  private allEntries: ImageEntry[] = [];
  private entries: ImageEntry[] = [];
  private entryIds = new Set<string>();
  private lastActiveTags: string[] | undefined = undefined;
  private lastFilterKey: string | undefined = undefined;
  private targetArea = 0;
  private vh = 0;
  private vw = 0;
  private rows = 2;
  private cellH = 0;
  private avgW = 0;
  private colSpacing = 0;
  private fillRatio = 1; // fraction of row-slots per column that get a card (0..1]
  private hasStaleCards = false;
  private bufferMargin = 400; // how far off-screen to pre-build columns
  // Column grid: tracks which column indices are currently materialized
  // Each column's cards are stored contiguously: column col → cards at indices [col*rows .. col*rows+rows-1]
  private materializedCols = new Set<number>();
  private gridOrigin = 0; // world-x of column 0 center

  // For distinguishing click from drag
  private pointerDownX = 0;
  private pointerDownY = 0;


  constructor() {
    if (!this.isBrowser) return;

    // Set active tags from route param (supports + delimited multi-tag slugs)
    // Subscribe to paramMap so back/forward navigation updates tags
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tagsParam = params.get('tags');
      if (tagsParam && tagsParam !== 'about') {
        const slugs = tagsParam.split('+').map(t => decodeURIComponent(t));
        this.siteConfig.setActiveFromSlugs(slugs);
        this.location.replaceState('/' + slugs.join('+'));
      } else if (!tagsParam) {
        // Navigated to root — clear tags
        if (this.siteConfig.activeTags().length > 0) {
          this.siteConfig.activeTags.set([]);
        }
      }
    });

    // Pause river when about panel is open
    effect(() => {
      const open = this.siteConfig.aboutOpen();
      if (open) {
        this.pauseRiver();
      } else if (this.riverPaused && !this.lightboxOpen() && !this.nsfwPromptOpen()) {
        this.resumeRiver();
      }
    });

    // When work-safe is turned off, prefetch all unblurred NSFW thumbs so they're
    // cached by the service worker before the user goes offline.
    effect(() => {
      const blurOn = this.siteConfig.nsfwBlur();
      if (!blurOn && this.allEntries.length > 0) {
        for (const entry of this.allEntries) {
          if (entry.nsfw && entry.thumbBlur) {
            new Image().src = entry.thumb;
            new Image().src = entry.full;
          }
        }
      }
    });

    // Rebuild river when active tags or sort order change
    effect(() => {
      const tags = this.siteConfig.activeTags();
      const sort = this.siteConfig.config()?.sortOrder ?? 'random';
      const key = tags.join('+') + '|' + sort;
      if (this.lastFilterKey === undefined) {
        this.lastFilterKey = key;
        this.lastActiveTags = tags;
        return; // skip initial
      }
      if (key === this.lastFilterKey) return;
      this.lastFilterKey = key;
      this.lastActiveTags = tags;
      if (this.allEntries.length > 0) {
        this.applyFilter();
      }
    });

    afterNextRender(async () => {
      await loadObserver();

      if (this.state.cards && this.state.entries) {
        this.allEntries = this.state.entries;
        this.entries = this.filterEntries(this.allEntries);
        this.entryIds = new Set(this.entries.map(e => e.id));
        this.offset = this.state.offset;
        this.cards.set(this.state.cards);
        this.initMetrics();
        this.loading.set(false);
        this.startRiver();
        this.setupObserver();
        this.startManifestPoll();
        this.checkDeepLink();
      } else {
        this.fetchManifest();
      }

      this.listenResize();
      this.listenKeyboard();
    });
  }

  private filterEntries(entries: ImageEntry[]): ImageEntry[] {
    const tags = this.siteConfig.activeTags();
    let result = tags.length === 0 ? [...entries] : entries.filter(e => tags.some(t => e.tags.includes(t)));
    const sort = this.siteConfig.config()?.sortOrder ?? 'random';
    if (sort === 'random') {
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
    } else if (sort === 'date-asc') {
      result.sort((a, b) => (a.captureDate || a.filename).localeCompare(b.captureDate || b.filename));
    } else {
      result.sort((a, b) => (b.captureDate || b.filename).localeCompare(a.captureDate || a.filename));
    }
    return result;
  }

  private applyFilter(): void {
    const prevEntryIds = this.entryIds;
    this.entries = this.filterEntries(this.allEntries);
    this.entryIds = new Set(this.entries.map(e => e.id));
    this.empty.set(this.entries.length === 0);
    this.siteConfig.hasNsfw.set(this.entries.some(e => e.nsfw));
    this.recalcFillRatio();
    this.hasStaleCards = true;

    // Animated bump when new images enter the pool or no visible cards remain
    const hasNew = this.entries.some(e => !prevEntryIds.has(e.id));
    const noVisibleCards = this.cards().length === 0 && this.entries.length > 0;
    if ((hasNew && prevEntryIds.size > 0) || noVisibleCards) {
      this.animateBump();
    }
  }


  private animateBump(dir?: -1 | 1): void {
    // Inject a velocity burst that decays naturally via the existing userSpeed friction
    const bumpDist = this.primaryLen;
    // sum of geometric series with 0.95 decay = initialSpeed / (1 - 0.95) = initialSpeed * 20
    const d = dir ?? (this.baseSpeed !== 0 ? Math.sign(this.baseSpeed) as -1 | 1 : -1);
    this.userSpeed = (bumpDist / 20) * d;
  }

  private initMetrics(): void {
    const el = this.canvas()?.nativeElement;
    this.vw = el?.clientWidth ?? window.innerWidth;
    this.vh = el?.clientHeight ?? window.innerHeight;

    const flow = this.siteConfig.config()?.flowDirection ?? 'rtl';
    this.vertical = flow === 'ttb' || flow === 'btt';
    const speedMap: Record<string, number> = { off: 0, low: 0.2, med: 0.5, high: 1.2 };
    const magnitude = speedMap[this.siteConfig.config()?.flowSpeed ?? 'med'] ?? 0.5;
    this.baseSpeed = (flow === 'ltr' || flow === 'btt') ? magnitude : -magnitude;

    // Primary axis = scroll direction, cross axis = lanes
    this.primaryLen = this.vertical ? this.vh : this.vw;
    const crossLen = this.vertical ? this.vw : this.vh;

    this.rows = laneCount(this.vw, this.vh);
    // For vertical flow, lanes run horizontally so use vw-based count
    if (this.vertical) {
      const ratio = this.vh / this.vw;
      this.rows = ratio > 1.3 ? 5 : ratio > 0.8 ? 7 : 9;
    }

    this.cellH = crossLen / this.rows;
    const avgH = this.cellH * 1.1;
    this.avgW = avgH * 1.2;
    this.targetArea = avgH * this.avgW;
    this.colSpacing = this.avgW * 1.4;
    this.bufferMargin = this.colSpacing * 0.5;
  }


  private fetchManifest(): void {
    this.http
      .get<ManifestResponse>('/api/manifest')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.allEntries = res.images;
          this.state.entries = res.images;
          this.siteConfig.hasNsfw.set(res.images.some(img => img.nsfw));
          const entries = this.filterEntries(res.images);
          this.entries = entries;
          this.entryIds = new Set(entries.map(e => e.id));
          this.state.manifestVersion = res.version;
          if (entries.length === 0) {
            this.empty.set(true);
            this.loading.set(false);
            return;
          }
          this.initMetrics();
          this.initCards(entries);
          this.loading.set(false);
          this.startRiver();
          this.setupObserver();
          this.startManifestPoll();
          this.checkDeepLink();
        },
        error: () => this.loading.set(false),
      });
  }

  private pickEntry(excludeIds: Set<string>): ImageEntry {
    const available = this.entries.filter(e => !excludeIds.has(e.id));
    if (available.length > 0) {
      const pick = available[Math.floor(Math.random() * available.length)];
      excludeIds.add(pick.id);
      return pick;
    }
    return this.entries[Math.floor(Math.random() * this.entries.length)];
  }

  /** World-x of a column center */
  private colCenterX(col: number): number {
    return this.gridOrigin + col * this.colSpacing;
  }

  /** Which columns are needed for a given camera offset */
  private getVisibleColRange(): [number, number] {
    return visibleColRange(this.offset, this.primaryLen, this.bufferMargin, this.gridOrigin, this.colSpacing);
  }

  /** Build all cards for a single column, skipping slots per fillRatio. */
  private buildColumn(col: number, allCards: FloatingImage[]): FloatingImage[] {
    // Proximity covers the full visible viewport width to minimize duplicates on screen
    const visCols = Math.ceil(this.primaryLen / this.colSpacing);
    const usedIds = nearbyIds(allCards, col, this.gridOrigin, this.colSpacing, Math.max(2, visCols), this.vertical);

    const colCards: FloatingImage[] = [];
    for (let row = 0; row < this.rows; row++) {
      if (Math.random() > this.fillRatio) continue;
      const entry = this.pickEntry(usedIds);
      colCards.push(this.makeCardInCell(entry, this.colCenterX(col), row, this.colSpacing));
    }
    return colCards;
  }

  /** What fraction of row-slots should be filled, given the entry pool size? */
  private recalcFillRatio(): void {
    const slotsPerScreen = Math.ceil((this.primaryLen || this.vw) / this.colSpacing) * this.rows;
    this.fillRatio = Math.min(1, (this.entries.length * 0.6) / slotsPerScreen);
  }

  private initCards(entries: ImageEntry[]): void {
    this.offset = 0;
    this.materializedCols.clear();
    this.gridOrigin = 0;

    this.recalcFillRatio();
    const cols = Math.max(1, Math.round((this.primaryLen * 2) / this.colSpacing));

    const initialCards: FloatingImage[] = [];
    const usedIds = new Set<string>();

    for (let col = 0; col < cols; col++) {
      this.materializedCols.add(col);
      for (let row = 0; row < this.rows; row++) {
        if (Math.random() > this.fillRatio) continue;
        const entry = this.pickEntry(usedIds);
        initialCards.push(this.makeCardInCell(entry, this.colCenterX(col), row, this.colSpacing));
      }
      // Reset used IDs periodically so the pool doesn't exhaust — but keep a rolling window
      if (usedIds.size > entries.length * 0.7) {
        usedIds.clear();
      }
    }

    this.cards.set(initialCards);
    this.persistState();
  }

  private startRiver(): void {
    const tick = () => {
      this.userSpeed *= 0.95;
      if (Math.abs(this.userSpeed) < 0.01) this.userSpeed = 0;

      const speed = this.baseSpeed + this.userSpeed;
      this.offset += speed;

      // Update container (single GPU-composited transform — won't disturb GIFs)
      const el = this.canvas()?.nativeElement;
      if (el) {
        const inner = el.querySelector('.river-inner') as HTMLElement;
        if (inner) {
          inner.style.transform = this.vertical
            ? `translateY(${-this.offset}px)`
            : `translateX(${-this.offset}px)`;
        }
      }

      // Add/remove columns as they scroll in/out of view
      this.ensureColumns();

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
    this.destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.rafId);
      // Clear persisted state so re-entering the gallery fetches fresh data
      this.state.cards = null;
      this.state.entries = null;
      this.state.offset = 0;
    });
  }

  /** Add columns about to scroll into view, remove columns that scrolled out. */
  private ensureColumns(): void {
    const [minCol, maxCol] = this.getVisibleColRange();
    let changed = false;
    let currentCards = this.cards();

    // Mark stale cards as exiting (animate out), then remove after transition.
    // Guard with a flag so this only fires once per filter change, not every frame.
    if (this.hasStaleCards) {
      this.hasStaleCards = false;
      currentCards = currentCards.map(c =>
        !this.entryIds.has(c.entry.id) ? { ...c, exiting: true } : c
      );
      changed = true;
      setTimeout(() => {
        this.cards.update(cards => cards.filter(c => !c.exiting));
      }, 450);
    }

    // Add new columns that are now in range
    for (let col = minCol; col <= maxCol; col++) {
      if (!this.materializedCols.has(col)) {
        this.materializedCols.add(col);
        const newCards = this.buildColumn(col, currentCards);
        currentCards = currentCards.concat(newCards);
        changed = true;
      }
    }

    // Remove columns that are out of range (with extra margin to avoid thrashing)
    const destroyMargin = 2;
    for (const col of this.materializedCols) {
      if (col < minCol - destroyMargin || col > maxCol + destroyMargin) {
        this.materializedCols.delete(col);
        const colCenter = this.colCenterX(col);
        const halfCell = this.colSpacing / 2;
        currentCards = currentCards.filter(c => {
          const cp = this.vertical ? c.y + c.h / 2 : c.x + c.w / 2;
          return cp < colCenter - halfCell || cp > colCenter + halfCell;
        });
        changed = true;
      }
    }

    if (changed) {
      this.cards.set(currentCards);
      this.persistState();
    }
  }

  private prevJitterX = 0;

  /** Create a card positioned within a grid cell.
   *  `colCenter` is along the primary (scroll) axis; `row` is a cross-axis lane. */
  private makeCardInCell(entry: ImageEntry, colCenter: number, row: number, cellW: number): FloatingImage {
    const aspect = entry.width && entry.height ? entry.width / entry.height : 1;
    const w = Math.sqrt(this.targetArea * aspect);
    const h = w / aspect;

    const laneCenter = row * this.cellH + this.cellH / 2;
    const rangePrimary = cellW - (this.vertical ? h : w) * 0.5;
    let jitterPrimary = (Math.random() - 0.5) * rangePrimary;
    if (Math.abs(jitterPrimary - this.prevJitterX) < rangePrimary * 0.2) {
      jitterPrimary = (Math.random() - 0.5) * rangePrimary;
    }
    this.prevJitterX = jitterPrimary;
    const jitterCross = (Math.random() - 0.5) * (this.cellH - (this.vertical ? w : h) * 0.5);

    let x: number, y: number;
    if (this.vertical) {
      y = colCenter + jitterPrimary - h / 2;
      x = laneCenter + jitterCross - w / 2;
    } else {
      x = colCenter + jitterPrimary - w / 2;
      y = laneCenter + jitterCross - h / 2;
    }

    const rotation = (Math.random() - 0.5) * 2 * MAX_ROTATION;
    const topBias = 1 - (row / Math.max(1, this.rows - 1));
    const z = Math.min(1, Math.max(0, topBias * 0.6 + Math.random() * 0.4));

    return { uid: _nextCardUid++, entry, x, y, w, h, rotation, z, zIndex: Math.round(z * 100), shadow: buildShadow(z) };
  }

  /** Reflow the grid when a resize crosses a lane-count threshold. */
  private listenResize(): void {
    const onResize = () => {
      // Reposition lightbox if open
      if (this.lightboxOpen() && this.lightboxEl && this.lightboxImage()) {
        this.resizeLightbox();
      }

      const el = this.canvas()?.nativeElement;
      const newRows = laneCount(el?.clientWidth ?? window.innerWidth, el?.clientHeight ?? window.innerHeight);
      if (newRows !== this.rows && this.entries.length > 0) {
        this.initMetrics();
        this.initCards(this.entries);
      }
    };
    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
  }

  /** Poll the manifest every 30s; on version change, swap entries and let recycle prune stale cards. */
  private startManifestPoll(): void {
    this.pollTimer = window.setInterval(() => {
      this.http.get<ManifestResponse>('/api/manifest').subscribe({
        next: (res) => {
          if (res.version === this.state.manifestVersion) return;
          this.state.manifestVersion = res.version;
          this.allEntries = res.images;
          this.state.entries = res.images;
          this.siteConfig.hasNsfw.set(res.images.some(img => img.nsfw));
          this.entries = this.filterEntries(res.images);
          this.entryIds = new Set(this.entries.map(e => e.id));
          this.hasStaleCards = true;
          this.bustImageCaches();
        },
      });
    }, 30_000);
    this.destroyRef.onDestroy(() => clearInterval(this.pollTimer));
  }

  /** Delete stale thumbnail/image entries from the service worker cache. */
  private bustImageCaches(): void {
    if (!('caches' in window)) return;
    caches.keys().then(names => {
      for (const name of names) {
        // Angular ngsw data caches are named like "ngsw:...:data:dynamic:thumbnails:cache"
        if (name.includes('thumbnails') || name.includes('images')) {
          caches.delete(name);
        }
      }
    });
  }

  private setupObserver(): void {
    const el = this.canvas()?.nativeElement;
    if (!el || !_Observer) return;

    this.observer = _Observer.create({
      target: el,
      type: 'wheel,touch,pointer',
      onChangeX: (self: any) => {
        if (this.lightboxOpen()) return;
        this.userSpeed -= (self.deltaX ?? 0) * 0.12;
        this.userSpeed = Math.max(-25, Math.min(25, this.userSpeed));
      },
      onChangeY: (self: any) => {
        if (this.lightboxOpen()) return;
        this.userSpeed -= (self.deltaY ?? 0) * 0.12;
        this.userSpeed = Math.max(-25, Math.min(25, this.userSpeed));
      },
      tolerance: 5,
      preventDefault: true,
    });

    this.destroyRef.onDestroy(() => this.observer?.kill());
  }

  onPointerDown(event: PointerEvent): void {
    this.pointerDownX = event.clientX;
    this.pointerDownY = event.clientY;
  }

  onPointerMove(): void {
  }

  onPointerUp(event: PointerEvent, image: FloatingImage, index: number): void {
    const dx = Math.abs(event.clientX - this.pointerDownX);
    const dy = Math.abs(event.clientY - this.pointerDownY);
    // Only open lightbox if pointer barely moved (click, not drag)
    if (dx < 20 && dy < 20) {
      this.openLightbox(image, index);
    }
  }

  private persistState(): void {
    this.state.cards = this.cards();
    this.state.offset = this.offset;
  }

  private pauseRiver(): void {
    if (this.riverPaused) return;
    this.riverPaused = true;
    cancelAnimationFrame(this.rafId);
    this.observer?.disable();
  }

  dismissNsfwPrompt(): void {
    this.nsfwPromptOpen.set(false);
    this.closeLightbox();
  }

  disableNsfwAndOpen(): void {
    this.nsfwPromptOpen.set(false);
    this.siteConfig.toggleNsfw();
    // Swap the lightbox image to the unblurred version
    if (this.lightboxEl) {
      const img = this.lightboxEl.querySelector('img') as HTMLImageElement;
      const image = this.lightboxImage();
      if (img && image) {
        img.src = image.entry.thumb;
        // Load full image
        const fullImg = new Image();
        fullImg.onload = () => { img.src = image.entry.full; img.style.objectFit = 'contain'; };
        fullImg.src = image.entry.full;
        // Add controls now that the image is viewable
        const el = this.canvas()?.nativeElement;
        if (el && !this.lightboxControls) {
          this.addLightboxControls(el, image);
        }
      }
    }
  }

  openLightbox(image: FloatingImage, cardIndex: number): void {
    if (this.lightboxOpen()) return;

    this.lightboxImage.set(image);
    this.lightboxOpen.set(true);

    this.pauseRiver();

    // Build navigation order: all cards sorted by x position (left to right)
    const currentCards = this.cards();
    this.lightboxOrder = currentCards
      .map((c, i) => ({ card: c, cardIndex: i }))
      .sort((a, b) => a.card.x - b.card.x);
    this.lightboxOrderIdx = this.lightboxOrder.findIndex(o => o.cardIndex === cardIndex);

    // Update URL without navigation — save current path unless it's already a /photo/ URL
    const currentPath = this.location.path() || '/';
    if (!currentPath.startsWith('/photo/')) {
      this.urlBeforeLightbox = currentPath;
    }
    const slug = slugify(image.entry.title || image.entry.id);
    this.location.replaceState('/photo/' + slug);

    // SEO meta
    this.seo.updateTags({
      title: this.siteConfig.pageTitle(image.entry.title || image.entry.id),
      image: image.entry.full,
    });
    if (image.entry.tags.length > 0) {
      this.seo.setKeywords(image.entry.tags);
    }

    this.animateOpen(image, cardIndex);

    // Show NSFW prompt over the blurred lightbox
    if (image.entry.nsfw && this.siteConfig.nsfwBlur() && image.entry.thumbBlur) {
      this.nsfwPromptOpen.set(true);
    }
  }

  private animateOpen(image: FloatingImage, cardIndex: number): void {
    const el = this.canvas()?.nativeElement;
    if (!el) return;

    // Get the card's screen-space rect to animate from, and hide the original
    const cardEls = el.querySelectorAll('.river-inner .river-card');
    const cardEl = cardEls[cardIndex] as HTMLElement | undefined;
    const rect = cardEl?.getBoundingClientRect();
    if (cardEl) {
      cardEl.style.visibility = 'hidden';
      this.lightboxSourceCard = cardEl;
    }

    // Push nearby cards away from the opened card
    this.displaceNeighbors(el, cardIndex, rect);

    const lbVw = window.innerWidth;
    const lbVh = window.innerHeight;

    const startX = rect ? rect.left : lbVw / 2 - image.w / 2;
    const startY = rect ? rect.top : lbVh / 2 - image.h / 2;
    const startW = rect ? rect.width : image.w;
    const startH = rect ? rect.height : image.h;

    // Create a fixed overlay element that mimics the card
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-zoom';
    overlay.style.cssText = `
      position:fixed; left:${startX}px; top:${startY}px;
      width:${startW}px; height:${startH}px;
      z-index:1000; cursor:pointer; border-radius:4px; overflow:hidden;
      touch-action:none; user-select:none; -webkit-user-select:none;
      transform:rotate(${image.rotation}deg);
      box-shadow:${image.shadow};
    `;
    const isBlurred = image.entry.nsfw && this.siteConfig.nsfwBlur() && !!image.entry.thumbBlur;
    const img = document.createElement('img');
    img.src = isBlurred ? image.entry.thumbBlur! : image.entry.thumb;
    img.draggable = false;
    img.style.cssText = 'display:block; width:100%; height:100%; object-fit:cover;';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => this.closeLightbox());
    this.attachSwipe(overlay);
    el.appendChild(overlay);
    this.lightboxEl = overlay;

    // Preload full image and swap when ready (skip for blurred NSFW — don't download unblurred content)
    const bannerH = image.entry.bannerHeight || 0;
    if (!isBlurred) {
      const fullImg = new Image();
      fullImg.onload = () => {
        img.src = image.entry.full;
        if (bannerH > 0) {
          // Scale the image so the visible portion (minus banner) fills the container,
          // then clip the banner off the bottom with overflow:hidden
          const visibleRatio = fullImg.naturalHeight / (fullImg.naturalHeight - bannerH);
          img.style.objectFit = 'fill';
          img.style.width = '100%';
          img.style.height = (100 * visibleRatio) + '%';
          overlay.style.overflow = 'hidden';
        } else {
          img.style.objectFit = 'contain';
        }
      };
      fullImg.src = image.entry.full;
    }

    // Calculate target: fill viewport, maintain aspect ratio (use original dimensions, not banner-extended)
    const pad = 16;
    const maxW = lbVw - pad * 2;
    const maxH = lbVh - pad * 2;
    const aspect = image.entry.width && image.entry.height
      ? image.entry.width / image.entry.height : 1;

    let targetW: number, targetH: number;
    if (maxW / maxH > aspect) {
      targetH = maxH;
      targetW = targetH * aspect;
    } else {
      targetW = maxW;
      targetH = targetW / aspect;
    }

    // Fade in curtain
    const curtain = el.querySelector('.lightbox-curtain') as HTMLElement;
    if (curtain) {
      gsap.to(curtain, { opacity: 1, duration: 0.4, ease: 'power2.out' });
    }

    // Animate overlay to center, then add controls
    gsap.to(overlay, {
      left: (lbVw - targetW) / 2,
      top: (lbVh - targetH) / 2,
      width: targetW,
      height: targetH,
      rotation: 0,
      boxShadow: '0 0 0 0 rgba(0,0,0,0)',
      borderRadius: '0px',
      duration: 0.5,
      ease: 'power2.out',
      onComplete: () => {
        if (!isBlurred) this.addLightboxControls(el, image);
      },
    });
  }

  private addLightboxControls(canvas: HTMLElement, image: FloatingImage): void {
    const lb = this.lightboxEl;
    if (!lb) return;
    const lbRect = lb.getBoundingClientRect();

    const controls = document.createElement('div');
    controls.className = 'lightbox-controls';
    controls.style.cssText = `
      position:fixed; z-index:1001; pointer-events:auto;
      left:${lbRect.left}px; top:${lbRect.top}px;
      width:${lbRect.width}px; height:${lbRect.height}px;
    `;
    controls.addEventListener('click', (e) => {
      if (e.target === controls) this.closeLightbox();
    });

    // Top-right actions (download + share + qr)
    const actions = document.createElement('div');
    actions.className = 'lb-actions';
    actions.style.cssText = `
      position:absolute; top:10px; right:10px;
      display:flex; gap:10px;
    `;

    const mkBtn = (html: string, title: string, handler: () => void) => {
      const btn = document.createElement('button');
      btn.className = 'lb-btn';

      btn.innerHTML = html;
      btn.title = title;
      btn.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
      return btn;
    };

    const dlBtn = mkBtn(
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
      'Download', () => this.downloadImage(image));

    const shareBtn = mkBtn(
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
      'Share', () => this.shareImage(image));
    shareBtn.dataset['role'] = 'share';

    const qrBtn = mkBtn(
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="17"/><line x1="14" y1="21" x2="17" y2="21"/><line x1="21" y1="21" x2="21" y2="21.01"/></svg>`,
      'QR Code', () => this.showQrCode(image));

    const deleteBtn = mkBtn(
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
      'Delete image', () => this.deleteImage(image));
    deleteBtn.className = 'lb-btn lb-btn-delete';

    const cfg = this.siteConfig.config();
    if (cfg?.enableDownload !== false) actions.appendChild(dlBtn);
    if (cfg?.enableShare !== false) actions.appendChild(shareBtn);
    if (cfg?.enableQr !== false) actions.appendChild(qrBtn);
    if (this.siteConfig.adminAuthenticated()) actions.appendChild(deleteBtn);
    if (actions.childElementCount > 0) controls.appendChild(actions);

    // Left chevron
    const hasLeft = this.lightboxOrderIdx > 0;
    const hasRight = this.lightboxOrderIdx < this.lightboxOrder.length - 1;

    if (hasLeft) {
      const left = document.createElement('button');
      left.className = 'lb-chevron lb-chevron-left';

      left.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
      left.addEventListener('click', (e) => { e.stopPropagation(); this.navigateLightbox(-1); });
      controls.appendChild(left);
    }

    if (hasRight) {
      const right = document.createElement('button');
      right.className = 'lb-chevron lb-chevron-right';

      right.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
      right.addEventListener('click', (e) => { e.stopPropagation(); this.navigateLightbox(1); });
      controls.appendChild(right);
    }

    canvas.appendChild(controls);
    this.lightboxControls = controls;

    // Fade controls on hover
    const show = () => { controls.classList.add('visible'); };
    const hide = () => { controls.classList.remove('visible'); };
    controls.addEventListener('mouseenter', show);
    controls.addEventListener('mouseleave', hide);
    if (controls.matches(':hover')) show();
    // Always visible on touch devices (no hover)
    if ('ontouchstart' in window) {
      controls.classList.add('visible');
    }
  }

  private deleteImage(image: FloatingImage): void {
    if (!confirm(`Delete "${image.entry.id}"? This cannot be undone.`)) return;
    this.http.delete(`/api/delete?id=${encodeURIComponent(image.entry.filename)}`).subscribe({
      next: () => {
        this.closeLightbox();
        // Remove the card from the current river
        const current = this.cards();
        this.cards.set(current.filter(c => c.entry.id !== image.entry.id));
      },
    });
  }

  private downloadImage(image: FloatingImage): void {
    const a = document.createElement('a');
    a.href = image.entry.full;
    a.download = image.entry.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private async shareImage(image: FloatingImage): Promise<void> {
    const url = window.location.origin + '/photo/' + encodeURIComponent(image.entry.id);
    if (navigator.share) {
      try {
        await navigator.share({ title: image.entry.id, url });
        return;
      } catch { /* user cancelled or not supported */ }
    }
    // Fallback: copy link to clipboard
    try {
      await navigator.clipboard.writeText(url);
      // Brief visual feedback on the share button
      const btn = this.lightboxControls?.querySelector('[data-role="share"]') as HTMLElement;
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
      }
    } catch { /* clipboard failed */ }
  }

  private async showQrCode(image: FloatingImage): Promise<void> {
    const url = window.location.origin + '/photo/' + encodeURIComponent(image.entry.id);
    const el = this.canvas()?.nativeElement;
    if (!el) return;

    const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });

    const overlay = document.createElement('div');
    overlay.className = 'qr-overlay';
    overlay.addEventListener('click', () => { overlay.remove(); this.qrOverlay = null; });

    const panel = document.createElement('div');
    panel.className = 'qr-panel';

    const qrImg = document.createElement('img');
    qrImg.src = dataUrl;
    qrImg.alt = 'QR Code';
    qrImg.style.cssText = 'display:block; width:200px; height:200px; border-radius:4px;';

    const label = document.createElement('p');
    label.textContent = 'Scan to view this photo';
    label.style.cssText = 'margin-top:0.75rem; color:var(--color-text-muted); font-size:0.8rem; text-align:center;';

    panel.appendChild(qrImg);
    panel.appendChild(label);
    overlay.appendChild(panel);
    el.appendChild(overlay);
    this.qrOverlay = overlay;
  }

  private displaceNeighbors(canvas: HTMLElement, cardIndex: number, sourceRect?: DOMRect): void {
    if (!sourceRect) return;
    const cardEls = canvas.querySelectorAll('.river-inner .river-card');
    const cx = sourceRect.left + sourceRect.width / 2;
    const cy = sourceRect.top + sourceRect.height / 2;
    const radius = Math.max(sourceRect.width, sourceRect.height) * 2.5;
    this.displacedCards = [];

    cardEls.forEach((el, i) => {
      if (i === cardIndex) return;
      const r = (el as HTMLElement).getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dist = Math.hypot(ex - cx, ey - cy);
      if (dist > radius || dist < 1) return;

      const strength = 1 - dist / radius;
      const angle = Math.atan2(ey - cy, ex - cx);
      const push = strength * 60;
      const dx = Math.cos(angle) * push;
      const dy = Math.sin(angle) * push;

      this.displacedCards.push({ el: el as HTMLElement, dx, dy });
      gsap.to(el, {
        x: `+=${dx}`,
        y: `+=${dy}`,
        duration: 0.4,
        ease: 'power2.out',
      });
    });
  }

  private restoreNeighbors(): void {
    for (const { el, dx, dy } of this.displacedCards) {
      gsap.to(el, {
        x: `-=${dx}`,
        y: `-=${dy}`,
        duration: 0.35,
        ease: 'power2.inOut',
      });
    }
    this.displacedCards = [];
  }

  navigateLightbox(dir: -1 | 1): void {
    if (!this.lightboxOpen() || this.lightboxNavigating) return;
    if (this.lightboxOrder.length === 0) return;

    const nextIdx = this.lightboxOrderIdx + dir;
    if (nextIdx < 0 || nextIdx >= this.lightboxOrder.length) return;

    const next = this.lightboxOrder[nextIdx];
    this.lightboxNavigating = true;

    // Close current, then open next (NSFW prompt shown automatically if needed)
    this.closeLightbox(() => {
      this.openLightbox(next.card, next.cardIndex);
      setTimeout(() => { this.lightboxNavigating = false; }, 300);
    });
  }

  closeLightbox(onDone?: () => void): void {
    // Block external close calls while navigating between images
    if (!onDone && this.lightboxNavigating) return;
    if (!this.lightboxOpen()) return;
    this.nsfwPromptOpen.set(false);

    const image = this.lightboxImage();
    if (!image) return;

    const el = this.canvas()?.nativeElement;
    const overlay = this.lightboxEl;
    const willReopen = !!onDone;

    // Restore URL (skip if navigating to next image)
    if (!willReopen) {
      this.location.replaceState(this.urlBeforeLightbox);
      this.seo.updateTags({ title: this.siteConfig.pageTitle() });
      this.seo.clearKeywords();
    }

    // Immediately fade out controls
    if (this.lightboxControls) {
      this.lightboxControls.classList.remove('visible');
    }

    // Fade out curtain (skip if navigating — curtain stays visible)
    if (!willReopen) {
      const curtain = el?.querySelector('.lightbox-curtain') as HTMLElement;
      if (curtain) {
        gsap.to(curtain, { opacity: 0, duration: 0.4, ease: 'power2.in' });
      }
    }

    this.restoreNeighbors();

    const finish = () => {
      if (this.lightboxSourceCard) {
        this.lightboxSourceCard.style.visibility = '';
        this.lightboxSourceCard = null;
      }
      if (overlay) { overlay.remove(); }
      if (this.lightboxControls) { this.lightboxControls.remove(); this.lightboxControls = null; }
      this.lightboxEl = null;
      this.lightboxOpen.set(false);
      this.lightboxImage.set(null);
      if (!willReopen) this.resumeRiver();
      onDone?.();
    };

    if (overlay) {
      const img = overlay.querySelector('img') as HTMLImageElement;
      overlay.style.overflow = 'hidden';

      // Animate back to the source card's actual screen position
      const sourceCard = this.lightboxSourceCard;
      let targetX: number, targetY: number, targetW: number, targetH: number;
      if (sourceCard) {
        const rect = sourceCard.getBoundingClientRect();
        targetX = rect.left;
        targetY = rect.top;
        targetW = rect.width;
        targetH = rect.height;
      } else {
        targetX = this.vertical ? image.x : image.x - this.offset;
        targetY = this.vertical ? image.y - this.offset : image.y;
        targetW = image.w;
        targetH = image.h;
      }

      // If the image has a banner, we need to cross-fade to avoid the banner flash.
      // Create a thumbnail overlay on top, fade it in, then animate the shrink.
      const bannerH = image.entry.bannerHeight || 0;
      const startShrink = () => {
        gsap.to(overlay, {
          left: targetX,
          top: targetY,
          width: targetW,
          height: targetH,
          rotation: image.rotation,
          boxShadow: image.shadow,
          borderRadius: '4px',
          duration: 0.35,
          ease: 'power2.in',
          onComplete: finish,
        });
      };

      if (bannerH > 0 && img) {
        // Place a thumbnail img on top of the full image, then shrink
        const thumbImg = document.createElement('img');
        const isBlurred = image.entry.nsfw && this.siteConfig.nsfwBlur() && !!image.entry.thumbBlur;
        thumbImg.src = isBlurred ? image.entry.thumbBlur! : image.entry.thumb;
        thumbImg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:1;';
        overlay.style.position = overlay.style.position || 'fixed';
        overlay.appendChild(thumbImg);
        // Wait one frame for the thumb to paint, then animate
        requestAnimationFrame(() => startShrink());
      } else {
        if (img) {
          img.style.objectFit = 'cover';
          img.style.width = '100%';
          img.style.height = '100%';
        }
        startShrink();
      }
    } else {
      finish();
    }
  }

  private resizeLightbox(): void {
    const image = this.lightboxImage();
    const overlay = this.lightboxEl;
    if (!image || !overlay) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 16;
    const maxW = vw - pad * 2;
    const maxH = vh - pad * 2;
    const aspect = image.entry.width && image.entry.height
      ? image.entry.width / image.entry.height : 1;

    let targetW: number, targetH: number;
    if (maxW / maxH > aspect) {
      targetH = maxH;
      targetW = targetH * aspect;
    } else {
      targetW = maxW;
      targetH = targetW / aspect;
    }

    const l = (vw - targetW) / 2;
    const t = (vh - targetH) / 2;
    gsap.set(overlay, { left: l, top: t, width: targetW, height: targetH });

    // Reposition controls to match
    if (this.lightboxControls) {
      this.lightboxControls.style.left = l + 'px';
      this.lightboxControls.style.top = t + 'px';
      this.lightboxControls.style.width = targetW + 'px';
      this.lightboxControls.style.height = targetH + 'px';
    }
  }

  private resumeRiver(): void {
    if (!this.riverPaused) return;
    this.riverPaused = false;
    this.observer?.enable();
    this.startRiver();
  }

  /** If the URL is /photo/:id on load, open that image's lightbox. */
  private checkDeepLink(): void {
    const param = this.route.snapshot.paramMap.get('id');
    if (!param) return;
    const slug = decodeURIComponent(param);

    const matchEntry = (e: { title: string; id: string }) =>
      slugify(e.title || e.id) === slug || e.id === slug || e.title === slug;

    const currentCards = this.cards();
    let index = currentCards.findIndex(c => matchEntry(c.entry));

    if (index >= 0) {
      setTimeout(() => this.openLightbox(currentCards[index], index), 100);
      return;
    }

    // Image not on screen — find it in entries and create a temporary card
    const entry = this.entries.find(matchEntry)
      || this.allEntries.find(matchEntry);
    if (entry) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const card = this.makeCardInCell(entry, vw / 2, 0, Math.min(vw, vh) * 0.4);
      const cards = [...currentCards, card];
      this.cards.set(cards);
      setTimeout(() => this.openLightbox(card, cards.length - 1), 100);
    }
  }

  private attachSwipe(target: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let dragging = false;
    let didSwipe = false;

    target.addEventListener('pointerdown', (e: PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      startTime = Date.now();
      dragging = true;
      didSwipe = false;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      e.preventDefault();
    });
    target.addEventListener('pointerup', (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const elapsed = Date.now() - startTime;
      // Require >100px horizontal movement, mostly horizontal, within 500ms
      if (Math.abs(dx) > 100 && Math.abs(dx) > Math.abs(dy) * 1.5 && elapsed < 500) {
        didSwipe = true;
        this.navigateLightbox(dx < 0 ? 1 : -1);
      }
    });
    // Suppress click after swipe
    target.addEventListener('click', (e: MouseEvent) => {
      if (didSwipe) { e.stopImmediatePropagation(); didSwipe = false; }
    }, { capture: true });
  }

  private listenKeyboard(): void {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.qrOverlay) {
          this.qrOverlay.remove();
          this.qrOverlay = null;
          return;
        }
        if (this.nsfwPromptOpen()) {
          this.dismissNsfwPrompt();
          return;
        }
        if (this.lightboxOpen()) {
          this.closeLightbox();
        }
        return;
      }
      if (this.lightboxOpen()) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.navigateLightbox(1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') this.navigateLightbox(-1);
        return;
      }
      // Arrow keys bump the main stream in the pressed direction
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        this.animateBump(-1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        this.animateBump(1);
      }
    };
    window.addEventListener('keydown', onKey);
    this.destroyRef.onDestroy(() => window.removeEventListener('keydown', onKey));
  }
}

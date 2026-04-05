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
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SeoService } from '@app/services/seo.service';
import { SiteConfigService, slugify } from '@app/services/site-config.service';
import { ConnectivityService } from '@app/services/connectivity.service';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import gsap from 'gsap';
import QRCode from 'qrcode';
import { GalleryStateService, FloatingImage, ImageEntry, ManifestResponse } from '@app/services/gallery-state.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Determine cross-axis lane count based on viewport aspect ratio and density setting. */
export function laneCount(vw: number, vh: number, density: 'low' | 'med' | 'high' = 'med'): number {
  const ratio = vw / vh;
  //                wide(>1.3)  square(>0.8)  tall
  // low:            4            5             6
  // med (default):  5            6             7
  // high:           6            7             8
  const base = ratio > 1.3 ? 4 : ratio > 0.8 ? 5 : 6;
  const offset = density === 'low' ? 0 : density === 'high' ? 2 : 1;
  return base + offset;
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
  private readonly connectivity = inject(ConnectivityService);

  private readonly prefersReducedMotion = this.isBrowser
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  private componentDestroyed = false;
  private lightboxSourceCard: HTMLElement | null = null;
  private urlBeforeLightbox = '/';
  private lightboxControls: HTMLElement | null = null;
  private qrOverlay: HTMLElement | null = null;
  private displacedCards: { el: HTMLElement; dx: number; dy: number }[] = [];
  private lightboxOrder: { card: FloatingImage; cardIndex: number }[] = [];
  private lightboxOrderIdx = -1;
  private preloadedImages: HTMLImageElement[] = []; // keep decoded images alive in memory
  private lightboxNavigating = false;
  private lightboxAnimatingOpen = false;
  private focusBeforeLightbox: HTMLElement | null = null;
  private boundTrapFocus: ((e: KeyboardEvent) => void) | null = null;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  private nextSeqIndex = 0; // sequential pick cursor for front (new content direction)
  private nextSeqIndexBack = 0; // sequential pick cursor for back (opposite scroll direction)
  private initialColMin = 0; // track initial column range to know front vs back
  private initialColMax = 0;

  // For distinguishing click from drag
  private pointerDownX = 0;
  private pointerDownY = 0;


  constructor() {
    this.destroyRef.onDestroy(() => { this.componentDestroyed = true; });
    if (!this.isBrowser) return;

    // Set active tags from route param (supports + delimited multi-tag slugs)
    // Subscribe to paramMap so back/forward navigation updates tags
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tagsParam = params.get('tags');
      if (tagsParam && tagsParam !== 'about') {
        const slugs = tagsParam.split('+').map(t => decodeURIComponent(t));
        this.siteConfig.setActiveFromSlugs(slugs);
        this.location.replaceState('/' + slugs.join('+'));
        this.seo.updateTags({ title: this.siteConfig.pageTitle(slugs.join(' + ')) });
      } else if (!tagsParam) {
        // Navigated to root — clear tags
        if (this.siteConfig.activeTags().length > 0) {
          this.siteConfig.activeTags.set([]);
        }
        this.seo.updateTags({ title: this.siteConfig.pageTitle() });
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

    // When work-safe mode changes, re-resolve which thumb to display.
    // Unblurred NSFW thumbs are only swapped in once confirmed loadable.
    effect(() => {
      this.siteConfig.nsfwBlur();
      if (this.allEntries.length > 0) {
        this.resolveDisplayThumbs();
      }
    });

    // When connectivity is restored, retry failed preloads and update lightbox share button
    effect(() => {
      const online = this.connectivity.isOnline();
      // Retry preload if previous attempt had errors (read untracked to avoid re-triggering)
      if (online && this.allEntries.length > 0 && untracked(() => this.state.downloadState()) === 'error') {
        this.preloadAllImages();
        this.resolveDisplayThumbs();
      }
      // Hide/show share button in open lightbox
      const controls = this.lightboxControls;
      if (!controls) return;
      const shareBtn = controls.querySelector('[data-role="share"]') as HTMLElement;
      if (shareBtn) shareBtn.style.display = online ? '' : 'none';
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
    const result = tags.length === 0 ? [...entries] : entries.filter(e => tags.some(t => e.tags.includes(t)));
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
    this.nextSeqIndex = 0;
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
    this.baseSpeed = (flow === 'rtl' || flow === 'ttb') ? magnitude : -magnitude;

    // Primary axis = scroll direction, cross axis = lanes
    this.primaryLen = this.vertical ? this.vh : this.vw;
    const crossLen = this.vertical ? this.vw : this.vh;

    const density = this.siteConfig.config()?.density ?? 'med';
    this.rows = laneCount(this.vw, this.vh, density);
    // For vertical flow, lanes run horizontally so use vw-based count
    if (this.vertical) {
      this.rows = laneCount(this.vh, this.vw, density);
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
          this.resolveDisplayThumbs();
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
          this.startManifestPoll(res.pending ? 5_000 : 30_000);
          this.checkDeepLink();
        },
        error: () => this.loading.set(false),
      });
  }

  private pickEntry(excludeIds: Set<string>, reverse = false): ImageEntry {
    const isRandom = (this.siteConfig.config()?.sortOrder ?? 'random') === 'random';
    if (isRandom) {
      const available = this.entries.filter(e => !excludeIds.has(e.id));
      if (available.length > 0) {
        const pick = available[Math.floor(Math.random() * available.length)];
        excludeIds.add(pick.id);
        return pick;
      }
      return this.entries[Math.floor(Math.random() * this.entries.length)];
    }
    const len = this.entries.length;
    if (reverse) {
      // Walk backwards through sorted entries
      for (let attempts = 0; attempts < len; attempts++) {
        if (this.nextSeqIndexBack < 0) this.nextSeqIndexBack = len - 1;
        const pick = this.entries[this.nextSeqIndexBack--];
        if (!excludeIds.has(pick.id)) {
          excludeIds.add(pick.id);
          return pick;
        }
      }
      if (this.nextSeqIndexBack < 0) this.nextSeqIndexBack = len - 1;
      return this.entries[this.nextSeqIndexBack--];
    }
    // Forward: walk through sorted entries
    for (let attempts = 0; attempts < len; attempts++) {
      if (this.nextSeqIndex >= len) this.nextSeqIndex = 0;
      const pick = this.entries[this.nextSeqIndex++];
      if (!excludeIds.has(pick.id)) {
        excludeIds.add(pick.id);
        return pick;
      }
    }
    if (this.nextSeqIndex >= len) this.nextSeqIndex = 0;
    return this.entries[this.nextSeqIndex++];
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
    const visCols = Math.ceil(this.primaryLen / this.colSpacing);
    const usedIds = nearbyIds(allCards, col, this.gridOrigin, this.colSpacing, Math.max(2, visCols), this.vertical);
    const isRandom = (this.siteConfig.config()?.sortOrder ?? 'random') === 'random';
    const flow = this.siteConfig.config()?.flowDirection ?? 'rtl';
    const originIsRight = flow === 'rtl' || flow === 'ttb';

    if (!isRandom) {
      // New columns on the origin side (where images come from) continue
      // the sequence forward; columns on the destination side get tail picks.
      const isFront = originIsRight ? col > this.initialColMax : col < this.initialColMin;
      return this.buildSeqColumn(col, usedIds, !isFront);
    }

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

  private buildSeqColumn(col: number, usedIds: Set<string>, reverse: boolean): FloatingImage[] {
    const cards: FloatingImage[] = [];
    const activeRows: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      if (Math.random() > this.fillRatio) continue;
      activeRows.push(row);
    }
    const colEntries: ImageEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let r = 0; r < activeRows.length; r++) {
      colEntries.push(this.pickEntry(usedIds, reverse));
    }
    // Shuffle row assignments for visual variety
    for (let r = activeRows.length - 1; r > 0; r--) {
      const j = Math.floor(Math.random() * (r + 1));
      [activeRows[r], activeRows[j]] = [activeRows[j], activeRows[r]];
    }
    for (let r = 0; r < colEntries.length; r++) {
      cards.push(this.makeCardInCell(colEntries[r], this.colCenterX(col), activeRows[r], this.colSpacing));
    }
    return cards;
  }

  private initCards(entries: ImageEntry[]): void {
    this.offset = 0;
    this.materializedCols.clear();
    this.gridOrigin = this.colSpacing / 2;
    this.nextSeqIndex = 0;

    this.recalcFillRatio();
    const cols = Math.max(1, Math.round((this.primaryLen * 2) / this.colSpacing));

    const initialCards: FloatingImage[] = [];
    const usedIds = new Set<string>();
    const isRandom = (this.siteConfig.config()?.sortOrder ?? 'random') === 'random';

    if (isRandom) {
      for (let col = 0; col < cols; col++) {
        this.materializedCols.add(col);
      }
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < this.rows; row++) {
          if (Math.random() > this.fillRatio) continue;
          const entry = this.pickEntry(usedIds);
          initialCards.push(this.makeCardInCell(entry, this.colCenterX(col), row, this.colSpacing));
        }
        if (usedIds.size > entries.length * 0.7) {
          usedIds.clear();
        }
      }
    } else {
      // How many columns fit on screen
      const visCols = Math.ceil(this.primaryLen / this.colSpacing);
      const flow = this.siteConfig.config()?.flowDirection ?? 'rtl';
      const tailCount = 3;
      // Three zones on initial load:
      //   dest-side off-screen: tail entries (z y x) — wrap-around illusion
      //   visible:              newest-first at dest side (d c b a)
      //   origin-side off-screen: continues sequence (e f g)
      //
      // ltr (→): dest=RIGHT, origin=LEFT  → layout: g f e | d c b a | z y x
      // rtl (←): dest=LEFT,  origin=RIGHT → layout: x y z | a b c d | e f g
      const destIsRight = flow === 'ltr' || flow === 'btt';

      const visCols_arr: number[] = [];  // visible, filled dest→origin
      const originCols: number[] = [];   // off-screen origin side, forward seq
      const tailCols: number[] = [];     // off-screen dest side, tail entries

      if (destIsRight) {
        // ltr: visible rightmost first (gets a), origin off-screen left, tail off-screen right
        for (let col = visCols - 1; col >= 0; col--) visCols_arr.push(col);
        for (let i = 1; i <= tailCount; i++) originCols.push(-i);
        for (let i = 0; i < tailCount; i++) tailCols.push(visCols + i);
      } else {
        // rtl: visible leftmost first (gets a), origin off-screen right, tail off-screen left
        for (let col = 0; col < visCols; col++) visCols_arr.push(col);
        for (let i = 0; i < tailCount; i++) originCols.push(visCols + i);
        for (let i = 1; i <= tailCount; i++) tailCols.push(-i);
      }

      const allInitCols = [...visCols_arr, ...originCols, ...tailCols];
      for (const col of allInitCols) this.materializedCols.add(col);

      // Visible + origin columns: forward through sorted list
      for (const col of [...visCols_arr, ...originCols]) {
        initialCards.push(...this.buildSeqColumn(col, usedIds, false));
      }

      // Tail columns: reverse from end of sorted list
      this.nextSeqIndexBack = this.entries.length - 1;
      for (const col of tailCols) {
        initialCards.push(...this.buildSeqColumn(col, usedIds, true));
      }

      this.initialColMin = Math.min(...allInitCols);
      this.initialColMax = Math.max(...allInitCols);
    }

    this.cards.set(initialCards);
    this.persistState();
    this.preloadAllImages();
  }

  /** Preload images for offline use via the service worker cache.
   *  SFW: all thumbs + full images. NSFW: only blurred thumbs (unblurred
   *  content is prefetched separately when the user toggles blur off). */
  private preloadAllImages(): void {
    const blurOn = this.siteConfig.nsfwBlur();
    const urls: string[] = [];

    for (const entry of this.allEntries) {
      if (entry.nsfw && entry.thumbBlur) {
        urls.push(entry.thumbBlur);
        if (!blurOn) {
          urls.push(entry.thumb);
          urls.push(entry.full);
        }
      } else if (!entry.nsfw) {
        urls.push(entry.thumb);
        urls.push(entry.full);
      }
    }

    // Deduplicate
    const unique = [...new Set(urls)];
    if (unique.length === 0) return;

    let i = 0;
    let hasError = false;
    const downloadState = this.state.downloadState;
    downloadState.set('downloading');
    const loadNext = () => {
      if (this.componentDestroyed) return;
      if (i >= unique.length) {
        downloadState.set(hasError ? 'error' : 'done');
        return;
      }
      const img = new Image();
      img.onload = () => { if (!this.componentDestroyed) this.preloadedImages.push(img); loadNext(); };
      img.onerror = () => { hasError = true; loadNext(); };
      img.src = unique[i++];
    };
    // Start after the UI is idle, one at a time to avoid bandwidth contention
    if ('requestIdleCallback' in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => loadNext());
    } else {
      setTimeout(loadNext, 1000);
    }
  }

  /** Set _displayThumb on each entry. For NSFW with blur on, use thumbBlur.
   *  When blur is off, attempt to load the unblurred thumb — keep showing
   *  the blurred version until the unblurred one is confirmed loadable. */
  private resolveDisplayThumbs(): void {
    const blurOn = this.siteConfig.nsfwBlur();
    let needsUpdate = false;
    const nsfwToLoad: ImageEntry[] = [];
    for (const entry of this.allEntries) {
      if (!entry.nsfw || !entry.thumbBlur) {
        entry._displayThumb = entry.thumb;
      } else if (blurOn) {
        entry._displayThumb = entry.thumbBlur;
        needsUpdate = true;
      } else {
        // Blur just turned off — keep blurred thumb until unblurred loads
        entry._displayThumb = entry.thumbBlur;
        nsfwToLoad.push(entry);
      }
    }
    if (needsUpdate) this.cards.update(c => [...c]);
    if (nsfwToLoad.length > 0) this.prefetchNsfwEntries(nsfwToLoad);
  }

  private prefetchNsfwEntries(entries: ImageEntry[]): void {
    let remaining = entries.length * 2; // thumb + full per entry
    let hasError = false;
    const downloadState = this.state.downloadState;
    downloadState.set('downloading');
    const onDone = () => {
      if (this.componentDestroyed) return;
      remaining--;
      if (remaining <= 0) {
        downloadState.set(hasError ? 'error' : 'done');
      }
    };
    for (const entry of entries) {
      const img = new Image();
      img.onload = () => {
        if (this.componentDestroyed) return;
        entry._displayThumb = entry.thumb;
        this.cards.update(c => [...c]);
        onDone();
      };
      img.onerror = () => { hasError = true; onDone(); };
      img.src = entry.thumb;
      const full = new Image();
      full.onload = onDone;
      full.onerror = () => { hasError = true; onDone(); };
      full.src = entry.full;
    }
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
      if (this.skipEnsureFrames > 0) {
        this.skipEnsureFrames--;
      } else {
        this.ensureColumns();
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
    this.destroyRef.onDestroy(() => {
      this.componentDestroyed = true;
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
      const newVw = el?.clientWidth ?? window.innerWidth;
      const newVh = el?.clientHeight ?? window.innerHeight;
      const density = this.siteConfig.config()?.density ?? 'med';
      const newRows = laneCount(newVw, newVh, density);
      if (newRows !== this.rows && this.entries.length > 0) {
        this.initMetrics();
        this.initCards(this.entries);
      } else {
        // Row count unchanged — rescale cross-axis positions and card sizes only
        const crossLen = this.vertical ? newVw : newVh;
        const newCellH = crossLen / this.rows;
        if (this.cellH > 0 && Math.abs(newCellH - this.cellH) > 0.5) {
          const scale = newCellH / this.cellH;
          this.cellH = newCellH;
          this.vw = newVw;
          this.vh = newVh;
          this.primaryLen = this.vertical ? this.vh : this.vw;
          const cards = this.cards();
          for (const card of cards) {
            if (this.vertical) { card.x *= scale; } else { card.y *= scale; }
            card.w *= scale;
            card.h *= scale;
          }
          this.cards.set([...cards]);
        }
      }
    };
    window.addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
  }

  /** Poll the manifest; on version change, swap entries and let recycle prune stale cards. */
  private startManifestPoll(initialDelay = 30_000): void {
    const poll = () => {
      this.http.get<ManifestResponse>('/api/manifest').pipe(take(1)).subscribe({
        next: (res) => {
          const changed = res.version !== this.state.manifestVersion;
          if (changed) {
            this.state.manifestVersion = res.version;
            this.allEntries = res.images;
            this.state.entries = res.images;
            this.siteConfig.hasNsfw.set(res.images.some(img => img.nsfw));
            this.entries = this.filterEntries(res.images);
            this.entryIds = new Set(this.entries.map(e => e.id));
            this.hasStaleCards = true;
            this.bustImageCaches();
          }
          // Poll faster while images are still being processed
          const delay = res.pending ? 5_000 : 30_000;
          this.pollTimer = window.setTimeout(poll, delay);
        },
      });
    };
    this.pollTimer = window.setTimeout(poll, initialDelay);
    this.destroyRef.onDestroy(() => clearTimeout(this.pollTimer));
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
      onChangeX: (self: { deltaX?: number; deltaY?: number }) => {
        if (this.lightboxOpen()) return;
        this.userSpeed -= (self.deltaX ?? 0) * 0.12;
        this.userSpeed = Math.max(-25, Math.min(25, this.userSpeed));
      },
      onChangeY: (self: { deltaX?: number; deltaY?: number }) => {
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

  onCardClick(event: MouseEvent, image: FloatingImage, index: number): void {
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
    this.lightboxControls?.querySelector('.lightbox-banner')?.remove();
    this.lightboxEl?.querySelector('.lightbox-banner')?.remove();
    this.closeLightbox();
  }


  disableNsfwAndOpen(): void {
    this.nsfwPromptOpen.set(false);
    this.siteConfig.toggleNsfw();
    if (!this.lightboxEl) return;
    // Remove the NSFW banner
    this.lightboxControls?.querySelector('.lightbox-banner')?.remove();
    this.lightboxEl.querySelector('.lightbox-banner')?.remove();
    // Swap the lightbox image to the unblurred version
    const img = this.lightboxEl.querySelector('img') as HTMLImageElement;
    const image = this.lightboxImage();
    if (img && image) {
      img.src = image.entry.thumb;
      img.onerror = () => {
        img.onerror = null;
        if (image.entry.thumbBlur) img.src = image.entry.thumbBlur;
        this.showLightboxBanner(this.lightboxControls || this.lightboxEl!, 'You appear to be offline. Reconnect to view this image.');
      };
      // Load full image
      const fullImg = new Image();
      fullImg.onload = () => { img.src = image.entry.full; img.style.objectFit = 'contain'; };
      fullImg.onerror = () => {
        if (image.entry.thumbBlur && img.src === image.entry.thumbBlur) {
          this.showLightboxBanner(this.lightboxControls || this.lightboxEl!, 'You appear to be offline. Reconnect to view this image.');
        }
      };
      fullImg.src = image.entry.full;
      // Rebuild controls with full actions now that the image is viewable
      const el = this.canvas()?.nativeElement;
      if (el) {
        if (this.lightboxControls) { this.lightboxControls.remove(); this.lightboxControls = null; }
        this.addLightboxControls(el, image);
      }
    }
  }

  openLightbox(image: FloatingImage, cardIndex: number): void {
    if (this.lightboxOpen()) return;

    // Start curtain fade via CSS transition — takes effect immediately,
    // not blocked by subsequent synchronous work
    const el = this.canvas()?.nativeElement;
    const curtain = el?.querySelector('.lightbox-curtain') as HTMLElement;
    if (curtain) {
      const dur = this.prefersReducedMotion ? 0 : 0.3;
      curtain.style.transition = `opacity ${dur}s ease-out`;
      curtain.style.opacity = '1';
    }

    this.focusBeforeLightbox = document.activeElement as HTMLElement | null;
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
      title: this.siteConfig.pageTitle(undefined, image.entry.title || image.entry.id),
      image: image.entry.full,
    });
    if (image.entry.tags.length > 0) {
      this.seo.setKeywords(image.entry.tags);
    }

    this.animateOpen(image, cardIndex);

    // Show NSFW banner on the blurred lightbox image
    if (image.entry.nsfw && this.siteConfig.nsfwBlur() && image.entry.thumbBlur) {
      this.nsfwPromptOpen.set(true);
    }
  }


  private animateOpen(image: FloatingImage, cardIndex: number): void {
    const el = this.canvas()?.nativeElement;
    if (!el) return;

    const cardEls = el.querySelectorAll('.river-inner .river-card');
    const cardEl = cardEls[cardIndex] as HTMLElement | undefined;
    const rect = cardEl?.getBoundingClientRect();
    if (cardEl) {
      cardEl.style.opacity = '0';
      this.lightboxSourceCard = cardEl;
    }

    this.displaceNeighbors(el, cardIndex, rect);

    const lbVw = window.innerWidth;
    const lbVh = window.innerHeight;
    const startX = rect ? rect.left : lbVw / 2 - image.w / 2;
    const startY = rect ? rect.top : lbVh / 2 - image.h / 2;
    const startW = rect ? rect.width : image.w;
    const startH = rect ? rect.height : image.h;

    const pad = 16;
    const maxW = lbVw - pad * 2;
    const maxH = lbVh - pad * 2;
    const aspect = image.entry.width && image.entry.height
      ? image.entry.width / image.entry.height : 1;

    const bannerH = image.entry.bannerHeight || 0;
    let targetW: number, targetH: number;
    if (maxW / maxH > aspect) {
      targetH = Math.floor(maxH);
      targetW = Math.floor(targetH * aspect);
    } else {
      targetW = Math.floor(maxW);
      targetH = Math.floor(targetW / aspect);
    }
    if (bannerH > 0) targetH -= 2;

    const targetX = (lbVw - targetW) / 2;
    const targetY = (lbVh - targetH) / 2;
    const isBlurred = image.entry.nsfw && this.siteConfig.nsfwBlur() && !!image.entry.thumbBlur;
    const duration = this.prefersReducedMotion ? 0 : 0.45;

    // Build overlay at card position/size with the thumbnail
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-zoom';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Photo: ${image.entry.title || image.entry.id}`);
    overlay.style.cssText = `
      position:fixed; left:${startX}px; top:${startY}px;
      width:${startW}px; height:${startH}px;
      z-index:1000; cursor:pointer; border-radius:4px; overflow:hidden;
      touch-action:none; user-select:none; -webkit-user-select:none;
      transform:rotate(${image.rotation}deg);
      box-shadow:${image.shadow};
    `;

    const img = document.createElement('img');
    img.src = isBlurred ? image.entry.thumbBlur! : image.entry.thumb;
    img.draggable = false;
    img.style.cssText = 'display:block; width:100%; height:auto;';
    overlay.appendChild(img);

    const swipeState = this.attachSwipe(overlay, () => this.closeLightbox());
    // Also handle swipe on the curtain (dark area around the image)
    const curtain = el.querySelector('.lightbox-curtain') as HTMLElement;
    if (curtain) this.attachSwipe(curtain, () => this.closeLightbox());
    // Desktop click-to-close (touch uses tap handler in attachSwipe)
    overlay.addEventListener('click', () => {
      if (!this.lightboxAnimatingOpen && swipeState.scale <= 1) this.closeLightbox();
    });
    el.appendChild(overlay);
    this.lightboxEl = overlay;

    // Preload full image in background — swap only after animation completes
    let decodedImg: HTMLImageElement | null = null;
    let animDone = false;
    const trySwap = () => {
      if (!animDone || !decodedImg || this.lightboxEl !== overlay) return;
      const fullEl = document.createElement('img');
      fullEl.src = decodedImg.src;
      fullEl.draggable = false;
      if (bannerH > 0) {
        // Width 100% with auto height — image scales to fill width,
        // banner overflows below and gets clipped
        fullEl.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:auto; display:block;';
      } else {
        fullEl.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; object-fit:fill; display:block;';
      }
      fullEl.style.visibility = 'hidden';
      overlay.appendChild(fullEl);
      requestAnimationFrame(() => {
        fullEl.style.visibility = '';
        img.style.visibility = 'hidden';
      });
    };
    if (!isBlurred) {
      const fullImg = new Image();
      fullImg.src = image.entry.full;
      fullImg.decode().then(() => { decodedImg = fullImg; trySwap(); }, () => {
        // Full image failed to load (likely offline / not cached)
        if (image.entry.nsfw && image.entry.thumbBlur) {
          img.src = image.entry.thumbBlur;
          this.showLightboxBanner(this.lightboxControls || overlay, 'You appear to be offline. Reconnect to view this image.');
        }
      });
      // If unblurred thumb also fails, fall back to blurred thumb
      if (image.entry.nsfw && image.entry.thumbBlur) {
        img.onerror = () => {
          img.onerror = null;
          img.src = image.entry.thumbBlur!;
          this.showLightboxBanner(this.lightboxControls || overlay, 'You appear to be offline. Reconnect to view this image.');
        };
      }
    }

    // Animate from card position to center
    this.lightboxAnimatingOpen = true;
    gsap.to(overlay, {
      left: targetX,
      top: targetY,
      width: targetW,
      height: targetH,
      rotation: 0,
      borderRadius: '0px',
      boxShadow: '0 0 0 0 rgba(0,0,0,0)',
      duration,
      ease: 'power2.out',
      force3D: true,
      onComplete: () => {
        this.lightboxAnimatingOpen = false;
        // Remove GSAP's internal cache so manual style.transform (pinch zoom) works
        gsap.killTweensOf(overlay);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (overlay as any)._gsap;
        // Re-apply position without GSAP
        overlay.style.left = targetX + 'px';
        overlay.style.top = targetY + 'px';
        overlay.style.width = targetW + 'px';
        overlay.style.height = targetH + 'px';
        overlay.style.transform = 'none';
        overlay.style.borderRadius = '0';
        overlay.style.boxShadow = 'none';
        animDone = true;
        trySwap();
        this.addLightboxControls(el, image, isBlurred);
        if (isBlurred && this.lightboxControls) {
          this.showLightboxBanner(this.lightboxControls, 'This image is not work-safe.', {
            label: 'Disable Work-Safe & View',
            handler: () => this.disableNsfwAndOpen(),
          });
        }
      },
    });
  }

  private showLightboxBanner(overlay: HTMLElement, text: string, action?: { label: string; handler: () => void }): void {
    // Remove existing banner if present
    overlay.querySelector('.lightbox-banner')?.remove();
    const banner = document.createElement('div');
    banner.className = 'lightbox-banner';
    const span = document.createElement('span');
    span.textContent = text;
    banner.appendChild(span);
    if (action) {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); action.handler(); });
      banner.appendChild(btn);
    }
    overlay.appendChild(banner);
  }

  private addLightboxControls(canvas: HTMLElement, image: FloatingImage, hideActions = false): void {
    const lb = this.lightboxEl;
    if (!lb) return;
    const lbRect = lb.getBoundingClientRect();

    const controls = document.createElement('div');
    controls.className = 'lightbox-controls';
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    controls.style.cssText = `
      position:fixed; z-index:1001;
      pointer-events:${isTouch ? 'none' : 'auto'};
      left:${lbRect.left}px; top:${lbRect.top}px;
      width:${lbRect.width}px; height:${lbRect.height}px;
    `;
    if (!isTouch) {
      controls.addEventListener('click', (e) => {
        if (e.target === controls) this.closeLightbox();
      });
    }

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
      btn.setAttribute('aria-label', title);
      btn.querySelector('svg')?.setAttribute('aria-hidden', 'true');
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
    if (!hideActions) {
      if (cfg?.enableDownload !== false) actions.appendChild(dlBtn);
      if (cfg?.enableShare !== false && this.connectivity.isOnline()) actions.appendChild(shareBtn);
      if (cfg?.enableQr !== false) actions.appendChild(qrBtn);
      if (this.siteConfig.adminAuthenticated()) actions.appendChild(deleteBtn);
    }
    if (actions.childElementCount > 0) {
      // Add toggle button for mobile — CSS media query hides/shows it
      const toggle = document.createElement('button');
      toggle.className = 'lb-btn lb-actions-toggle';
      toggle.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
      toggle.title = 'Actions';
      toggle.setAttribute('aria-label', 'Toggle actions');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = actions.classList.toggle('lb-actions-expanded');
        toggle.classList.toggle('lb-actions-toggle-active', expanded);
      });
      controls.appendChild(toggle);
      controls.appendChild(actions);
    }

    // Left chevron
    const hasLeft = this.lightboxOrderIdx > 0;
    const hasRight = this.lightboxOrderIdx < this.lightboxOrder.length - 1;

    if (hasLeft) {
      const left = document.createElement('button');
      left.className = 'lb-chevron lb-chevron-left';
      left.setAttribute('aria-label', 'Previous image');
      left.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>`;
      left.addEventListener('click', (e) => { e.stopPropagation(); this.navigateLightbox(-1); });
      controls.appendChild(left);
    }

    if (hasRight) {
      const right = document.createElement('button');
      right.className = 'lb-chevron lb-chevron-right';
      right.setAttribute('aria-label', 'Next image');
      right.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;
      right.addEventListener('click', (e) => { e.stopPropagation(); this.navigateLightbox(1); });
      controls.appendChild(right);
    }

    // Info tray (title + description) — only when description exists
    const hasDesc = !!image.entry.description;
    if (hasDesc) {
      const hasTitle = image.entry.title && image.entry.title !== image.entry.id;

      // Wrapper: bottom anchored below photo. overflow:hidden clips panel.
      // Slides out from behind the image, then expands upward on hover.
      const wrapper = document.createElement('div');
      wrapper.className = 'lb-info-wrapper';
      wrapper.style.cssText = `position:fixed; z-index:1002; left:${lbRect.left}px; top:${lbRect.bottom}px; width:${lbRect.width}px; height:0px;`;
      // Slide in after a frame so the transition kicks in
      requestAnimationFrame(() => { wrapper.style.height = '16px'; });

      // Arrow hint: 16px tall, always visible at top of wrapper
      const arrowWrap = document.createElement('div');
      arrowWrap.className = 'lb-info-arrow-wrap';
      arrowWrap.innerHTML = `<svg class="lb-info-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
      wrapper.appendChild(arrowWrap);

      // Panel: title + desc, below the arrow
      const panel = document.createElement('div');
      panel.className = 'lb-info-panel';

      if (hasTitle) {
        const titleEl = document.createElement('div');
        titleEl.className = 'lb-info-title';
        titleEl.textContent = image.entry.title;
        panel.appendChild(titleEl);
      }
      const descEl = document.createElement('div');
      descEl.className = 'lb-info-desc';
      descEl.textContent = image.entry.description;
      panel.appendChild(descEl);

      wrapper.appendChild(panel);
      canvas.appendChild(wrapper);

      wrapper.dataset['baseTop'] = String(lbRect.bottom);
      const expand = () => {
        wrapper.classList.add('lb-info-expanded');
        const bt = parseFloat(wrapper.dataset['baseTop']!);
        const expandH = 16 + panel.scrollHeight + 16;
        wrapper.style.height = expandH + 'px';
        wrapper.style.top = (bt - (expandH - 16)) + 'px';
      };
      const collapse = () => {
        wrapper.classList.remove('lb-info-expanded');
        const bt = parseFloat(wrapper.dataset['baseTop']!);
        wrapper.style.height = '16px';
        wrapper.style.top = bt + 'px';
      };

      // Desktop: hover on wrapper expands, leave collapses
      wrapper.addEventListener('mouseenter', expand);
      wrapper.addEventListener('mouseleave', collapse);

      // Mobile: swipe or tap to toggle
      let touchStartY = 0;
      let touchMoved = false;
      wrapper.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; touchMoved = false; }, { passive: true });
      wrapper.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
      wrapper.addEventListener('touchend', (e) => {
        const dy = touchStartY - e.changedTouches[0].clientY;
        if (dy > 20) expand();
        else if (dy < -20) collapse();
        else if (!touchMoved) { if (wrapper.classList.contains('lb-info-expanded')) collapse(); else expand(); }
      });
      wrapper.addEventListener('click', (e) => { e.stopPropagation(); });
    }

    canvas.appendChild(controls);
    this.lightboxControls = controls;

    // Fade controls on hover
    const show = () => { controls.classList.add('visible'); };
    const hide = () => { controls.classList.remove('visible'); };
    if (isTouch) {
      controls.classList.add('visible');
    } else {
      controls.addEventListener('mouseenter', show);
      controls.addEventListener('mouseleave', hide);
      if (controls.matches(':hover')) show();
    }

    // Focus trap: keep Tab cycling within lightbox controls
    const focusableSelector = 'button, [href], [tabindex]:not([tabindex="-1"])';
    this.boundTrapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = controls.querySelectorAll(focusableSelector);
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (e.shiftKey) {
        if (document.activeElement === first || !controls.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !controls.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', this.boundTrapFocus);

    // Move focus into the first lightbox button
    const firstBtn = controls.querySelector('button') as HTMLElement | null;
    firstBtn?.focus();
  }

  private deleteImage(image: FloatingImage): void {
    if (!confirm(`Delete "${image.entry.id}"? This cannot be undone.`)) return;
    this.http.delete(`/api/delete?id=${encodeURIComponent(image.entry.filename)}`).pipe(take(1)).subscribe({
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
    const dur = this.prefersReducedMotion ? 0 : 0.35;

    cardEls.forEach((el, i) => {
      if (i === cardIndex) return;
      const card = el as HTMLElement;
      const r = card.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dist = Math.hypot(ex - cx, ey - cy);
      if (dist > radius || dist < 1) return;

      const strength = 1 - dist / radius;
      const angle = Math.atan2(ey - cy, ex - cx);
      const push = strength * 60;
      const dx = Math.cos(angle) * push;
      const dy = Math.sin(angle) * push;

      this.displacedCards.push({ el: card, dx, dy });
      gsap.to(card, { '--dx': `${dx}px`, '--dy': `${dy}px`, duration: dur, ease: 'power2.out' });
    });
  }

  private restoreNeighbors(onDone?: () => void): void {
    if (this.displacedCards.length === 0) {
      onDone?.();
      return;
    }

    const dur = this.prefersReducedMotion ? 0 : 0.35;
    if (dur === 0) {
      for (const { el } of this.displacedCards) {
        el.style.removeProperty('--dx');
        el.style.removeProperty('--dy');
      }
      this.displacedCards = [];
      onDone?.();
      return;
    }
    let remaining = this.displacedCards.length;
    for (const { el } of this.displacedCards) {
      gsap.to(el, {
        '--dx': '0px', '--dy': '0px', duration: dur, ease: 'power2.inOut',
        onComplete: () => {
          el.style.removeProperty('--dx');
          el.style.removeProperty('--dy');
          if (--remaining === 0) {
            this.displacedCards = [];
            onDone?.();
          }
        },
      });
    }
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

    // If the open animation is still running, kill it before closing
    this.lightboxAnimatingOpen = false;
    const el = this.canvas()?.nativeElement;
    const overlay = this.lightboxEl;
    if (overlay) gsap.killTweensOf(overlay);
    const willReopen = !!onDone;

    // Restore URL (skip if navigating to next image)
    if (!willReopen) {
      this.location.replaceState(this.urlBeforeLightbox);
      const tags = this.siteConfig.activeTags();
      this.seo.updateTags({ title: this.siteConfig.pageTitle(tags.length ? tags.join(' + ') : undefined) });
      this.seo.clearKeywords();
    }

    // Immediately fade out controls and slide info wrapper closed
    if (this.lightboxControls) {
      this.lightboxControls.classList.remove('visible');
    }
    const infoWrapper = el?.querySelector('.lb-info-wrapper') as HTMLElement | null;
    if (infoWrapper) {
      infoWrapper.classList.remove('lb-info-expanded');
      infoWrapper.classList.add('lb-info-closing');
      infoWrapper.style.height = '0px';
    }

    const closeDuration = this.prefersReducedMotion ? 0 : 0.35;

    // Fade out curtain (skip if navigating — curtain stays visible)
    if (!willReopen) {
      const curtain = el?.querySelector('.lightbox-curtain') as HTMLElement;
      if (curtain) {
        curtain.style.transition = `opacity ${closeDuration}s cubic-bezier(0.42,0,1,1)`;
        curtain.style.opacity = '0';
      }
    }

    // Start restoring neighbors (may complete instantly if none displaced)
    this.restoreNeighbors();

    const finish = () => {
      if (this.lightboxSourceCard) {
        this.lightboxSourceCard.style.transition = 'none';
        this.lightboxSourceCard.style.opacity = '';
        void this.lightboxSourceCard.offsetHeight; // force reflow
        this.lightboxSourceCard.style.transition = '';
        this.lightboxSourceCard = null;
      }
      if (this.lightboxControls) { this.lightboxControls.remove(); this.lightboxControls = null; }
      const canvas = this.canvas()?.nativeElement;
      canvas?.querySelector('.lb-info-wrapper')?.remove();
      if (this.boundTrapFocus) {
        document.removeEventListener('keydown', this.boundTrapFocus);
        this.boundTrapFocus = null;
      }
      this.lightboxEl = null;
      if (overlay) { overlay.remove(); }
      this.lightboxOpen.set(false);
      this.lightboxImage.set(null);
      if (!willReopen) {
        this.resumeRiver();
        this.focusBeforeLightbox?.focus();
        this.focusBeforeLightbox = null;
      }
      onDone?.();
    };

    if (overlay) {
      overlay.style.overflow = 'hidden';

      const sourceCard = this.lightboxSourceCard;
      let cardX: number, cardY: number, cardW: number, cardH: number;
      if (sourceCard) {
        const rect = sourceCard.getBoundingClientRect();
        cardX = rect.left;
        cardY = rect.top;
        cardW = rect.width;
        cardH = rect.height;
      } else {
        cardX = this.vertical ? image.x : image.x - this.offset;
        cardY = this.vertical ? image.y - this.offset : image.y;
        cardW = image.w;
        cardH = image.h;
      }

      const startShrink = () => {
        gsap.to(overlay, {
          left: cardX,
          top: cardY,
          width: cardW,
          height: cardH,
          rotation: image.rotation,
          boxShadow: image.shadow,
          borderRadius: '4px',
          duration: closeDuration,
          ease: 'power2.in',
          force3D: true,
          onComplete: finish,
        });
      };

      // Swap back to thumbnail for the shrink animation: show the original
      // thumb (hidden during open) and hide the full-res image so the
      // thumbnail's object-fit:cover crops correctly as the overlay shrinks.
      const imgs = overlay.querySelectorAll('img');
      const thumb = imgs[0] as HTMLImageElement | undefined;
      if (thumb) {
        thumb.style.cssText = 'display:block; position:absolute; inset:0; width:100%; height:100%; object-fit:cover;';
      }
      // Hide full-res image (if swapped in)
      for (let i = 1; i < imgs.length; i++) {
        (imgs[i] as HTMLElement).style.visibility = 'hidden';
      }
      // Delay shrink so the info hint retracts first
      if (infoWrapper) {
        setTimeout(startShrink, 100);
      } else {
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

    const bannerH = image.entry.bannerHeight || 0;
    let targetW: number, targetH: number;
    if (maxW / maxH > aspect) {
      targetH = Math.floor(maxH);
      targetW = Math.floor(targetH * aspect);
    } else {
      targetW = Math.floor(maxW);
      targetH = Math.floor(targetW / aspect);
    }
    if (bannerH > 0) targetH -= 2;

    const l = (vw - targetW) / 2;
    const t = (vh - targetH) / 2;
    overlay.style.left = l + 'px';
    overlay.style.top = t + 'px';
    overlay.style.width = targetW + 'px';
    overlay.style.height = targetH + 'px';

    // Reposition controls to match
    if (this.lightboxControls) {
      this.lightboxControls.style.left = l + 'px';
      this.lightboxControls.style.top = t + 'px';
      this.lightboxControls.style.width = targetW + 'px';
      this.lightboxControls.style.height = targetH + 'px';
    }

    // Reposition info wrapper (top-anchored at photo bottom)
    const canvas = this.canvas()?.nativeElement;
    const wrapperEl = canvas?.querySelector('.lb-info-wrapper') as HTMLElement | null;
    if (wrapperEl) {
      const newBaseTop = t + targetH;
      wrapperEl.dataset['baseTop'] = String(newBaseTop);
      wrapperEl.style.left = l + 'px';
      wrapperEl.style.top = newBaseTop + 'px';
      wrapperEl.style.width = targetW + 'px';
    }
  }

  private resumeRiver(): void {
    if (!this.riverPaused) return;
    this.riverPaused = false;
    // Skip column management for a few frames after resume to prevent stream jump
    this.skipEnsureFrames = 10;
    this.observer?.enable();
    this.startRiver();
  }

  private skipEnsureFrames = 0;

  /** If the URL is /photo/:id on load, open that image's lightbox. */
  private checkDeepLink(): void {
    const param = this.route.snapshot.paramMap.get('id');
    if (!param) return;
    const slug = decodeURIComponent(param);

    const matchEntry = (e: { title: string; id: string }) =>
      slugify(e.title || e.id) === slug || e.id === slug || e.title === slug;

    const currentCards = this.cards();
    const index = currentCards.findIndex(c => matchEntry(c.entry));

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

  private attachSwipe(target: HTMLElement, onClose?: () => void): { scale: number; resetZoom: () => void } {
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let didSwipe = false;

    // Pinch-to-zoom + pan state
    let initialPinchDist = 0;
    let currentScale = 1;
    let panX = 0;
    let panY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;
    let pinchActive = false;
    let panning = false;

    const applyTransform = (scale: number, x: number, y: number) => {
      target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    };

    const updateControlsVisibility = () => {
      const controls = this.lightboxControls;
      if (!controls) return;
      if (currentScale > 1) {
        controls.style.opacity = '0';
        controls.style.pointerEvents = 'none';
      } else {
        controls.style.opacity = '';
        const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        controls.style.pointerEvents = isTouch ? 'none' : '';
        if (isTouch) controls.classList.add('visible');
      }
    };

    let animatingReset = false;

    const state = {
      get scale() { return currentScale; },
      resetZoom: () => {
        currentScale = 1;
        panX = 0;
        panY = 0;
        animatingReset = true;
        target.style.transition = 'transform 0.3s ease-out';
        target.style.transform = 'none';
        const onEnd = () => {
          target.style.transition = '';
          animatingReset = false;
        };
        target.addEventListener('transitionend', onEnd, { once: true });
        // Safety: clear transition even if transitionend doesn't fire
        setTimeout(onEnd, 350);
        updateControlsVisibility();
      },
    };

    target.addEventListener('touchstart', (e: TouchEvent) => {
      if (animatingReset) {
        target.style.transition = '';
        animatingReset = false;
      }

      if (e.touches.length === 2) {
        pinchActive = true;
        panning = false;
        initialPinchDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        panStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        panStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        panStartPanX = panX;
        panStartPanY = panY;
        e.preventDefault();
      } else if (e.touches.length === 1) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        didSwipe = false;
        if (currentScale > 1) {
          panning = true;
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          panStartPanX = panX;
          panStartPanY = panY;
        }
      }
    }, { passive: false });

    target.addEventListener('touchmove', (e: TouchEvent) => {
      if (pinchActive && e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        const scale = Math.max(1, Math.min(5, currentScale * (dist / initialPinchDist)));
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        panX = panStartPanX + (midX - panStartX);
        panY = panStartPanY + (midY - panStartY);
        applyTransform(scale, panX, panY);
        e.preventDefault();
      } else if (panning && e.touches.length === 1) {
        const dx = e.touches[0].clientX - panStartX;
        const dy = e.touches[0].clientY - panStartY;
        panX = panStartPanX + dx;
        panY = panStartPanY + dy;
        applyTransform(currentScale, panX, panY);
        e.preventDefault();
      }
    }, { passive: false });

    target.addEventListener('touchend', (e: TouchEvent) => {
      // Ignore gestures while the open animation is still running
      if (this.lightboxAnimatingOpen) return;

      if (pinchActive) {
        if (e.touches.length < 2) {
          const transform = target.style.transform;
          const match = transform.match(/scale\(([\d.]+)\)/);
          currentScale = match ? parseFloat(match[1]) : 1;
          if (currentScale <= 1.05) {
            state.resetZoom();
          } else {
            updateControlsVisibility();
          }
          pinchActive = false;
        }
        return;
      }

      if (panning) {
        const touch = e.changedTouches[0];
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        panning = false;
        if (dx < 10 && dy < 10) {
          state.resetZoom();
        }
        return;
      }

      if (e.changedTouches.length === 1 && currentScale <= 1) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        const elapsed = Date.now() - startTime;
        if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5 && elapsed < 500) {
          didSwipe = true;
          this.navigateLightbox(dx < 0 ? 1 : -1);
        } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && elapsed < 300) {
          if (onClose) onClose();
        }
      }
    });

    // Suppress click after swipe
    target.addEventListener('click', (e: MouseEvent) => {
      if (didSwipe) { e.stopImmediatePropagation(); didSwipe = false; }
    }, { capture: true });

    // Reset zoom when this overlay is removed
    const observer = new MutationObserver(() => {
      if (!target.parentNode) {
        currentScale = 1;
        panX = 0;
        panY = 0;
        observer.disconnect();
      }
    });
    if (target.parentNode) {
      observer.observe(target.parentNode, { childList: true });
    }

    return state;
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

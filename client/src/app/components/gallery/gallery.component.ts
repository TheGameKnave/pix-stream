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
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SeoService } from '@app/services/seo.service';
import { SiteConfigService } from '@app/services/site-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import gsap from 'gsap';
import { GalleryStateService, FloatingImage, ImageEntry, ManifestResponse } from '@app/services/gallery-state.service';

let _Observer: any = null;

async function loadObserver(): Promise<void> {
  if (_Observer) return;
  const mod = await import('gsap/dist/Observer.js' as string);
  _Observer = mod.Observer || mod.default?.Observer || mod.default;
  if (_Observer) gsap.registerPlugin(_Observer);
}

const MAX_ROTATION = 15;

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
): Set<string> {
  const ids = new Set<string>();
  for (const c of cards) {
    const cardCol = Math.round((c.x + c.w / 2 - gridOrigin) / colSpacing);
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
  return { entry, x, y, w, h, rotation, z, zIndex: Math.round(z * 100), shadow: buildShadow(z) };
}

@Component({
  selector: 'app-gallery',
  templateUrl: 'gallery.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly seo = inject(SeoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly state = inject(GalleryStateService);
  readonly siteConfig = inject(SiteConfigService);

  readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  readonly cards = signal<FloatingImage[]>([]);
  readonly loading = signal(true);

  // Lightbox state
  readonly lightboxOpen = signal(false);
  readonly lightboxImage = signal<FloatingImage | null>(null);
  private riverPaused = false;
  private lightboxEl: HTMLElement | null = null;
  private lightboxSourceCard: HTMLElement | null = null;
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
  private baseSpeed = -0.5; // offset change per frame; negative = flow L→R
  private userSpeed = 0;
  private rafId = 0;
  private pollTimer = 0;
  private observer: any = null;
  private allEntries: ImageEntry[] = [];
  private entries: ImageEntry[] = [];
  private entryIds = new Set<string>();
  private lastActiveTags: string[] | undefined = undefined; // track to detect changes
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
    const tagsParam = this.route.snapshot.paramMap.get('tags');
    if (tagsParam && tagsParam !== 'about') {
      const slugs = tagsParam.split('+').map(t => decodeURIComponent(t));
      this.siteConfig.setActiveFromSlugs(slugs);
      // Angular encodes + as %2B in the URL — fix it
      this.location.replaceState('/' + slugs.join('+'));
    }

    // Rebuild river when active tags change
    effect(() => {
      const tags = this.siteConfig.activeTags();
      if (this.lastActiveTags === undefined) {
        this.lastActiveTags = tags;
        return; // skip initial
      }
      if (tags.join('+') === this.lastActiveTags.join('+')) return;
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
    if (tags.length === 0) return entries;
    return entries.filter(e => tags.some(t => e.tags.includes(t)));
  }

  private applyFilter(): void {
    this.entries = this.filterEntries(this.allEntries);
    this.entryIds = new Set(this.entries.map(e => e.id));
    this.siteConfig.hasNsfw.set(this.entries.some(e => e.nsfw));
    this.recalcFillRatio();
    this.hasStaleCards = true;
  }

  private initMetrics(): void {
    const el = this.canvas()?.nativeElement;
    this.vw = el?.clientWidth ?? window.innerWidth;
    this.vh = el?.clientHeight ?? window.innerHeight;
    this.rows = laneCount(this.vw, this.vh);
    this.cellH = this.vh / this.rows;
    // Size cards to ~80% of cell height so they fill rows nicely at any resolution
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
    return visibleColRange(this.offset, this.vw, this.bufferMargin, this.gridOrigin, this.colSpacing);
  }

  /** Build all cards for a single column, skipping slots per fillRatio. */
  private buildColumn(col: number, allCards: FloatingImage[]): FloatingImage[] {
    const usedIds = nearbyIds(allCards, col, this.gridOrigin, this.colSpacing, 2);

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
    const slotsPerScreen = Math.ceil(this.vw / this.colSpacing) * this.rows;
    this.fillRatio = Math.min(1, (this.entries.length * 0.6) / slotsPerScreen);
  }

  private initCards(entries: ImageEntry[]): void {
    this.offset = 0;
    this.materializedCols.clear();
    this.gridOrigin = 0;

    this.recalcFillRatio();
    const cols = Math.max(1, Math.round((this.vw * 2) / this.colSpacing));

    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const initialCards: FloatingImage[] = [];
    let idx = 0;

    for (let col = 0; col < cols; col++) {
      this.materializedCols.add(col);
      for (let row = 0; row < this.rows; row++) {
        if (Math.random() > this.fillRatio) continue;
        const entry = shuffled[idx % shuffled.length];
        idx++;
        initialCards.push(this.makeCardInCell(entry, this.colCenterX(col), row, this.colSpacing));
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
          inner.style.transform = `translateX(${-this.offset}px)`;
        }
      }

      // Add/remove columns as they scroll in/out of view
      this.ensureColumns();

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.rafId));
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
          const cx = c.x + c.w / 2;
          return cx < colCenter - halfCell || cx > colCenter + halfCell;
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

  /** Create a card positioned within a grid cell — same logic as initCards. */
  private makeCardInCell(entry: ImageEntry, cellCenterX: number, row: number, cellW: number): FloatingImage {
    const aspect = entry.width && entry.height ? entry.width / entry.height : 1;
    const w = Math.sqrt(this.targetArea * aspect);
    const h = w / aspect;

    const cellCenterY = row * this.cellH + this.cellH / 2;
    const rangeX = cellW - w * 0.5;
    let jitterX = (Math.random() - 0.5) * rangeX;
    // If this card's X jitter is too close to the previous row's, re-roll once
    // to avoid accidental vertical alignment.
    if (Math.abs(jitterX - this.prevJitterX) < rangeX * 0.2) {
      jitterX = (Math.random() - 0.5) * rangeX;
    }
    this.prevJitterX = jitterX;
    const jitterY = (Math.random() - 0.5) * (this.cellH - h * 0.5);

    const x = cellCenterX + jitterX - w / 2;
    const y = cellCenterY + jitterY - h / 2;
    const rotation = (Math.random() - 0.5) * 2 * MAX_ROTATION;
    const z = Math.random();

    return { entry, x, y, w, h, rotation, z, zIndex: Math.round(z * 100), shadow: buildShadow(z) };
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

  openLightbox(image: FloatingImage, cardIndex: number): void {
    if (this.lightboxOpen()) return;

    this.lightboxImage.set(image);
    this.lightboxOpen.set(true);

    // Pause river and disable Observer so it doesn't steal touch events
    this.riverPaused = true;
    cancelAnimationFrame(this.rafId);
    this.observer?.disable();

    // Build navigation order: all cards sorted by x position (left to right)
    const currentCards = this.cards();
    this.lightboxOrder = currentCards
      .map((c, i) => ({ card: c, cardIndex: i }))
      .sort((a, b) => a.card.x - b.card.x);
    this.lightboxOrderIdx = this.lightboxOrder.findIndex(o => o.cardIndex === cardIndex);

    // Update URL without navigation
    this.location.replaceState('/photo/' + encodeURIComponent(image.entry.id));

    // SEO meta
    this.seo.updateTags({
      title: image.entry.id + ' — Photo Stream',
      image: image.entry.full,
    });
    if (image.entry.tags.length > 0) {
      this.seo.setKeywords(image.entry.tags);
    }

    this.animateOpen(image, cardIndex);
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
    const img = document.createElement('img');
    img.src = image.entry.thumb;
    img.draggable = false;
    img.style.cssText = 'display:block; width:100%; height:100%; object-fit:cover; pointer-events:none;';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => this.closeLightbox());
    this.attachSwipe(overlay);
    el.appendChild(overlay);
    this.lightboxEl = overlay;

    // Preload full image and swap when ready
    const fullImg = new Image();
    fullImg.onload = () => { img.src = image.entry.full; img.style.objectFit = 'contain'; };
    fullImg.src = image.entry.full;

    // Calculate target: fill viewport, maintain aspect ratio
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

    // Animate overlay to center
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
    });
  }

  navigateLightbox(dir: -1 | 1): void {
    if (!this.lightboxOpen() || this.lightboxNavigating) return;
    if (this.lightboxOrder.length === 0) return;

    const nextIdx = this.lightboxOrderIdx + dir;
    if (nextIdx < 0 || nextIdx >= this.lightboxOrder.length) return;

    const next = this.lightboxOrder[nextIdx];
    this.lightboxNavigating = true;

    // Close current (animate back to card), then open next
    this.closeLightbox(() => {
      this.openLightbox(next.card, next.cardIndex);
      // Keep navigating flag up until stray click events have flushed
      setTimeout(() => { this.lightboxNavigating = false; }, 300);
    });
  }

  closeLightbox(onDone?: () => void): void {
    // Block external close calls while navigating between images
    if (!onDone && this.lightboxNavigating) return;
    if (!this.lightboxOpen()) return;

    const image = this.lightboxImage();
    if (!image) return;

    const el = this.canvas()?.nativeElement;
    const overlay = this.lightboxEl;
    const willReopen = !!onDone;

    // Restore URL (skip if navigating to next image)
    if (!willReopen) {
      this.location.replaceState('/');
      this.seo.updateTags({ title: 'Photo Stream' });
      this.seo.clearKeywords();
    }

    // Fade out curtain (skip if navigating — curtain stays visible)
    if (!willReopen) {
      const curtain = el?.querySelector('.lightbox-curtain') as HTMLElement;
      if (curtain) {
        gsap.to(curtain, { opacity: 0, duration: 0.4, ease: 'power2.in' });
      }
    }

    const finish = () => {
      if (this.lightboxSourceCard) {
        this.lightboxSourceCard.style.visibility = '';
        this.lightboxSourceCard = null;
      }
      if (overlay) { overlay.remove(); }
      this.lightboxEl = null;
      this.lightboxOpen.set(false);
      this.lightboxImage.set(null);
      if (!willReopen) this.resumeRiver();
      onDone?.();
    };

    if (overlay) {
      // Swap back to thumbnail for the shrink animation
      const img = overlay.querySelector('img') as HTMLImageElement;
      if (img) { img.src = image.entry.thumb; img.style.objectFit = 'cover'; }

      // Animate back to original card screen position
      const screenX = image.x - this.offset;
      const screenY = image.y;

      gsap.to(overlay, {
        left: screenX,
        top: screenY,
        width: image.w,
        height: image.h,
        rotation: image.rotation,
        boxShadow: image.shadow,
        borderRadius: '4px',
        duration: 0.35,
        ease: 'power2.in',
        onComplete: finish,
      });
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

    gsap.set(overlay, {
      left: (vw - targetW) / 2,
      top: (vh - targetH) / 2,
      width: targetW,
      height: targetH,
    });
  }

  private resumeRiver(): void {
    if (!this.riverPaused) return;
    this.riverPaused = false;
    this.observer?.enable();
    this.startRiver();
  }

  /** If the URL is /photo/:id on load, open that image's lightbox. */
  private checkDeepLink(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    const currentCards = this.cards();
    const index = currentCards.findIndex(c => c.entry.id === id);
    if (index >= 0) {
      setTimeout(() => this.openLightbox(currentCards[index], index), 100);
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
      if (!this.lightboxOpen()) return;
      if (e.key === 'Escape') this.closeLightbox();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.navigateLightbox(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') this.navigateLightbox(-1);
    };
    window.addEventListener('keydown', onKey);
    this.destroyRef.onDestroy(() => window.removeEventListener('keydown', onKey));
  }
}

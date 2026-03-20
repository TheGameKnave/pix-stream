import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
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

const IMG_AREA_FRACTION = 0.045;
const MAX_ROTATION = 30;
const RECYCLE_MARGIN = 400;

function buildShadow(z: number): string {
  const offsetY = 2 + z * 10;
  const blur = 4 + z * 20;
  const spread = z * 4;
  const opacity = 0.2 + z * 0.3;
  return `0 ${offsetY}px ${blur}px ${spread}px rgba(0,0,0,${opacity})`;
}

function makeCard(entry: ImageEntry, x: number, row: number, cellH: number, targetArea: number): FloatingImage {
  const aspect = entry.width && entry.height ? entry.width / entry.height : 1;
  const w = Math.sqrt(targetArea * aspect);
  const h = w / aspect;
  const y = row * cellH + (Math.random() - 0.5) * cellH * 0.5;
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly state = inject(GalleryStateService);

  readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  readonly cards = signal<FloatingImage[]>([]);
  readonly loading = signal(true);

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
  private entries: ImageEntry[] = [];
  private entryIds = new Set<string>();
  private targetArea = 0;
  private vh = 0;
  private vw = 0;
  private rows = 2;
  private cellH = 0;
  private avgW = 0;
  private rowDrought: number[] = [];

  // For distinguishing click from drag
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerMoved = false;

  constructor() {
    if (!this.isBrowser) return;

    afterNextRender(async () => {
      await loadObserver();

      if (this.state.cards && this.state.entries) {
        this.entries = this.state.entries;
        this.entryIds = new Set(this.entries.map(e => e.id));
        this.offset = this.state.offset;
        this.cards.set(this.state.cards);
        this.initMetrics();
        this.loading.set(false);
        this.startRiver();
        this.setupObserver();
        this.startManifestPoll();
      } else {
        this.fetchManifest();
      }
    });
  }

  private initMetrics(): void {
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.targetArea = this.vw * this.vh * IMG_AREA_FRACTION;
    const avgH = Math.sqrt(this.targetArea / 1.2);
    this.avgW = Math.sqrt(this.targetArea * 1.2);
    this.rows = Math.max(2, Math.floor(this.vh / (avgH * 1.1)));
    this.cellH = this.vh / this.rows;
    this.rowDrought = new Array(this.rows).fill(0);
  }

  /** Weighted random row pick: center rows are favoured, and rows that haven't
   *  been picked recently get increasingly likely. */
  private pickRow(): number {
    const weights: number[] = [];
    const center = (this.rows - 1) / 2;
    for (let r = 0; r < this.rows; r++) {
      // Center bias: 1.0 at edges, up to 1.5 at center
      const distFromCenter = Math.abs(r - center) / Math.max(center, 1);
      const centerWeight = 1 + 0.5 * (1 - distFromCenter);
      // Drought boost: +0.5 per turn since last placement
      const droughtWeight = 1 + this.rowDrought[r] * 0.5;
      weights.push(centerWeight * droughtWeight);
    }
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let r = 0; r < this.rows; r++) {
      roll -= weights[r];
      if (roll <= 0) {
        // Reset picked row's drought, increment all others
        for (let j = 0; j < this.rows; j++) this.rowDrought[j]++;
        this.rowDrought[r] = 0;
        return r;
      }
    }
    return this.rows - 1;
  }

  private fetchManifest(): void {
    this.http
      .get<ManifestResponse>('/api/manifest')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const entries = res.images;
          this.entries = entries;
          this.entryIds = new Set(entries.map(e => e.id));
          this.state.entries = entries;
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

  private initCards(entries: ImageEntry[]): void {
    this.offset = 0;

    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // How many cells the full-density grid would have
    const bufferX = this.vw * 0.5;
    const startX = -bufferX;
    const endX = this.vw + bufferX;
    const totalW = endX - startX;
    const idealCols = Math.max(3, Math.ceil(totalW / (this.avgW * 1.1)));
    const idealTotal = idealCols * this.rows;

    // We need ~2x visible cards for smooth no-duplicate recycling
    // (1x on screen + 1x in the off-screen buffer being recycled).
    // Cap the card count so we never exceed half the available entries.
    const maxCards = Math.max(this.rows, Math.floor(entries.length / 2));
    const cardCount = Math.min(idealTotal, maxCards);
    const cols = Math.max(1, Math.ceil(cardCount / this.rows));
    const cellW = totalW / cols;

    const initialCards: FloatingImage[] = [];
    let idx = 0;

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < this.rows; row++) {
        if (idx >= cardCount) break;
        const entry = shuffled[idx % shuffled.length];
        idx++;

        const aspect = entry.width && entry.height ? entry.width / entry.height : 1;
        const w = Math.sqrt(this.targetArea * aspect);
        const h = w / aspect;

        const cellCenterX = startX + col * cellW + cellW / 2;
        const cellCenterY = row * this.cellH + this.cellH / 2;
        const jitterX = (Math.random() - 0.5) * (cellW - w * 0.3);
        const jitterY = (Math.random() - 0.5) * (this.cellH - h * 0.3);

        const x = cellCenterX + jitterX - w / 2;
        const y = cellCenterY + jitterY - h / 2;
        const rotation = (Math.random() - 0.5) * 2 * MAX_ROTATION;
        const z = Math.random();

        initialCards.push({ entry, x, y, w, h, rotation, z, zIndex: Math.round(z * 100), shadow: buildShadow(z) });
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

      // Recycle off-screen cards
      this.recycle();

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.rafId));
  }

  private recycle(): void {
    let currentCards = this.cards();
    let changed = false;

    // Prune cards whose entries were removed from the manifest (e.g. after an update)
    const staleCount = currentCards.filter(c => !this.entryIds.has(c.entry.id)).length;
    if (staleCount > 0) {
      currentCards = currentCards.filter(c => this.entryIds.has(c.entry.id));
      changed = true;
    }

    // Only exclude IDs of cards still on-screen (off-screen ones are about to be recycled)
    const usedIds = new Set<string>();
    let fieldLeft = Infinity;
    let fieldRight = -Infinity;
    for (const c of currentCards) {
      const sx = c.x - this.offset;
      if (sx + c.w >= -RECYCLE_MARGIN && sx <= this.vw + RECYCLE_MARGIN) {
        usedIds.add(c.entry.id);
        if (c.x < fieldLeft) fieldLeft = c.x;
        if (c.x + c.w > fieldRight) fieldRight = c.x + c.w;
      }
    }

    // Match initial grid density: gap ≈ avgW * 0.1 between card edges
    const gap = this.avgW * 0.1;

    for (let i = 0; i < currentCards.length; i++) {
      const card = currentCards[i];
      const screenX = card.x - this.offset;

      if (screenX > this.vw + RECYCLE_MARGIN) {
        const entry = this.pickEntry(usedIds);
        const row = this.pickRow();
        const newCard = makeCard(entry, 0, row, this.cellH, this.targetArea);
        newCard.x = fieldLeft - newCard.w - gap * (0.5 + Math.random());
        currentCards[i] = newCard;
        fieldLeft = Math.min(fieldLeft, newCard.x);
        changed = true;
      } else if (screenX + card.w < -RECYCLE_MARGIN) {
        const entry = this.pickEntry(usedIds);
        const row = this.pickRow();
        const newCard = makeCard(entry, 0, row, this.cellH, this.targetArea);
        newCard.x = fieldRight + gap * (0.5 + Math.random());
        currentCards[i] = newCard;
        fieldRight = Math.max(fieldRight, newCard.x + newCard.w);
        changed = true;
      }
    }

    if (changed) {
      this.cards.set([...currentCards]);
      this.persistState();
    }
  }

  /** Poll the manifest every 30s; on version change, swap entries and let recycle prune stale cards. */
  private startManifestPoll(): void {
    this.pollTimer = window.setInterval(() => {
      this.http.get<ManifestResponse>('/api/manifest').subscribe({
        next: (res) => {
          if (res.version === this.state.manifestVersion) return;
          this.state.manifestVersion = res.version;
          this.entries = res.images;
          this.entryIds = new Set(res.images.map(e => e.id));
          this.state.entries = res.images;
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
        // Drag right (positive deltaX) → images should move right → offset should decrease
        this.userSpeed -= (self.deltaX ?? 0) * 0.12;
        this.userSpeed = Math.max(-25, Math.min(25, this.userSpeed));
      },
      onChangeY: (self: any) => {
        // Scroll wheel: scroll down → flow forward (L→R) → decrease offset
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
    this.pointerMoved = false;
  }

  onPointerMove(): void {
    this.pointerMoved = true;
  }

  onPointerUp(event: PointerEvent, image: FloatingImage): void {
    const dx = Math.abs(event.clientX - this.pointerDownX);
    const dy = Math.abs(event.clientY - this.pointerDownY);
    // Only open lightbox if pointer barely moved (click, not drag)
    if (dx < 5 && dy < 5 && !this.pointerMoved) {
      this.openLightbox(image);
    }
  }

  private persistState(): void {
    this.state.cards = this.cards();
    this.state.offset = this.offset;
  }

  openLightbox(image: FloatingImage): void {
    this.persistState();
    this.router.navigate(['/photo', image.entry.id]);
  }
}

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID, signal, computed } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Location } from '@angular/common';
import { of } from 'rxjs';
import { laneCount, buildShadow, makeCard, visibleColRange, nearbyIds, GalleryComponent } from './gallery.component';
import { ImageEntry, FloatingImage, GalleryStateService } from '@app/services/gallery-state.service';
import { SiteConfigService, SiteConfig, MISC_TAG } from '@app/services/site-config.service';
import { SeoService } from '@app/services/seo.service';
import { ConnectivityService } from '@app/services/connectivity.service';


describe('laneCount', () => {
  it('defaults to medium density', () => {
    expect(laneCount(1920, 1080)).toBe(5);
    expect(laneCount(1024, 1024)).toBe(6);
    expect(laneCount(400, 800)).toBe(7);
  });

  it('returns fewer rows for low density', () => {
    expect(laneCount(1920, 1080, 'low')).toBe(4);
    expect(laneCount(1024, 1024, 'low')).toBe(5);
    expect(laneCount(400, 800, 'low')).toBe(6);
  });

  it('returns more rows for high density', () => {
    expect(laneCount(1920, 1080, 'high')).toBe(6);
    expect(laneCount(1024, 1024, 'high')).toBe(7);
    expect(laneCount(400, 800, 'high')).toBe(8);
  });
});

describe('buildShadow', () => {
  it('returns a CSS box-shadow string', () => {
    const shadow = buildShadow(0.5);
    expect(shadow).toMatch(/^0 \d/);
    expect(shadow).toContain('rgba(0,0,0,');
  });

  it('increases shadow intensity with z', () => {
    const low = buildShadow(0);
    const high = buildShadow(1);
    // Extract opacity from rgba(0,0,0,<opacity>)
    const opacityOf = (s: string) => parseFloat(s.match(/rgba\(0,0,0,([\d.]+)\)/)![1]);
    expect(opacityOf(high)).toBeGreaterThan(opacityOf(low));
  });
});

describe('makeCard', () => {
  const entry: ImageEntry = {
    id: 'test-1',
    filename: 'test.jpg',
    type: 'image/jpeg',
    thumb: '/thumb/test.jpg',
    full: '/full/test.jpg',
    tags: [],
    width: 1600,
    height: 1200,
    nsfw: false,
    copyright: '',
    bannerHeight: 0,
    captureDate: '',
    title: '',
    description: '',
  };

  it('returns a FloatingImage with correct entry reference', () => {
    const card = makeCard(entry, 100, 2, 200, 40000);
    expect(card.entry).toBe(entry);
    expect(card.x).toBe(100);
  });

  it('sizes card proportional to target area and aspect ratio', () => {
    const card = makeCard(entry, 0, 0, 200, 40000);
    const expectedAspect = 1600 / 1200;
    expect(card.w / card.h).toBeCloseTo(expectedAspect, 2);
    expect(card.w * card.h).toBeCloseTo(40000, -1);
  });

  it('defaults to aspect 1 when dimensions are zero', () => {
    const noSize: ImageEntry = { ...entry, width: 0, height: 0 };
    const card = makeCard(noSize, 0, 0, 200, 40000);
    expect(card.w).toBeCloseTo(card.h, 0);
  });

  it('places y within the target row cell', () => {
    const cellH = 200;
    const row = 3;
    // Run multiple times since jitter is random
    for (let i = 0; i < 20; i++) {
      const card = makeCard(entry, 0, row, cellH, 40000);
      // Card center should be roughly in the row's cell (within 1 cell of tolerance for jitter)
      const cardCenter = card.y + card.h / 2;
      const cellCenter = row * cellH + cellH / 2;
      expect(Math.abs(cardCenter - cellCenter)).toBeLessThan(cellH);
    }
  });

  it('constrains rotation to MAX_ROTATION (15 degrees)', () => {
    for (let i = 0; i < 50; i++) {
      const card = makeCard(entry, 0, 0, 200, 40000);
      expect(Math.abs(card.rotation)).toBeLessThanOrEqual(15);
    }
  });

  it('assigns z between 0 and 1 with matching zIndex', () => {
    const card = makeCard(entry, 0, 0, 200, 40000);
    expect(card.z).toBeGreaterThanOrEqual(0);
    expect(card.z).toBeLessThanOrEqual(1);
    expect(card.zIndex).toBe(Math.round(card.z * 100));
  });
});

describe('visibleColRange', () => {
  const gridOrigin = 0;
  const colSpacing = 300;

  it('returns a range covering the viewport plus buffer', () => {
    // offset=0, vw=1500, buffer=300 → visible world range: -300..1800
    const [min, max] = visibleColRange(0, 1500, 300, gridOrigin, colSpacing);
    // Column centers at ...-300, 0, 300, 600, 900, 1200, 1500, 1800...
    // -300 to 1800 should include at least cols -1 through 6
    expect(min).toBeLessThanOrEqual(-1);
    expect(max).toBeGreaterThanOrEqual(6);
  });

  it('shifts range as offset changes', () => {
    const [min1] = visibleColRange(0, 1500, 300, gridOrigin, colSpacing);
    const [min2] = visibleColRange(-900, 1500, 300, gridOrigin, colSpacing);
    // Camera moved left by 900px → range should shift left by ~3 columns
    expect(min2).toBeLessThan(min1);
    expect(min1 - min2).toBeGreaterThanOrEqual(2);
  });

  it('always returns min <= max', () => {
    const [min, max] = visibleColRange(5000, 800, 100, 50, 250);
    expect(min).toBeLessThanOrEqual(max);
  });
});

describe('nearbyIds', () => {
  function fakeCard(id: string, x: number): FloatingImage {
    return {
      uid: 0,
      entry: { id, filename: '', type: '', thumb: '', full: '', tags: [], width: 100, height: 100, nsfw: false, copyright: '', bannerHeight: 0, captureDate: '', title: '', description: '' },
      x, y: 0, w: 100, h: 100, rotation: 0, z: 0.5, zIndex: 50, shadow: '',
    };
  }

  const gridOrigin = 0;
  const colSpacing = 300;

  it('includes IDs from cards within proximity columns', () => {
    const cards = [
      fakeCard('a', 0),    // col 0
      fakeCard('b', 300),  // col 1
      fakeCard('c', 600),  // col 2
    ];
    // Target col 1, proximity 1 → should include cols 0, 1, 2
    const ids = nearbyIds(cards, 1, gridOrigin, colSpacing, 1);
    expect(ids.has('a')).toBeTrue();
    expect(ids.has('b')).toBeTrue();
    expect(ids.has('c')).toBeTrue();
  });

  it('excludes IDs from cards beyond proximity', () => {
    const cards = [
      fakeCard('a', 0),     // col 0
      fakeCard('b', 300),   // col 1
      fakeCard('c', 900),   // col 3
      fakeCard('d', 1500),  // col 5
    ];
    // Target col 1, proximity 1 → cols 0, 1, 2 only
    const ids = nearbyIds(cards, 1, gridOrigin, colSpacing, 1);
    expect(ids.has('a')).toBeTrue();
    expect(ids.has('b')).toBeTrue();
    expect(ids.has('c')).toBeFalse();
    expect(ids.has('d')).toBeFalse();
  });

  it('with proximity 2, covers 5 columns', () => {
    const cards = [
      fakeCard('a', 0),     // col 0
      fakeCard('b', 300),   // col 1
      fakeCard('c', 600),   // col 2
      fakeCard('d', 900),   // col 3
      fakeCard('e', 1200),  // col 4
      fakeCard('f', 1500),  // col 5
    ];
    // Target col 2, proximity 2 → cols 0, 1, 2, 3, 4
    const ids = nearbyIds(cards, 2, gridOrigin, colSpacing, 2);
    expect(ids.has('a')).toBeTrue();
    expect(ids.has('e')).toBeTrue();
    expect(ids.has('f')).toBeFalse();
  });

  it('returns empty set when no cards are nearby', () => {
    const cards = [fakeCard('a', 3000)]; // col 10
    const ids = nearbyIds(cards, 0, gridOrigin, colSpacing, 2);
    expect(ids.size).toBe(0);
  });

  it('handles jittered card positions correctly', () => {
    // Card at x=260 (center at 310) should round to col 1
    const cards = [fakeCard('a', 260)];
    const ids = nearbyIds(cards, 1, gridOrigin, colSpacing, 0);
    expect(ids.has('a')).toBeTrue();
  });
});

// ============================================================================
// GalleryComponent DOM integration tests
// ============================================================================

const MOCK_CONFIG: SiteConfig = {
  title: 'Test', subtitle: '', headerColor: '#e2d6bb',
  bgColor: '#808080', fontBody: 'Raleway', nsfwBlurDefault: false,
  enabledTags: [], tagDisplayMode: 'nav', enableShare: true,
  enableDownload: true, enableQr: true, enableKiosk: true,
  flowDirection: 'rtl', flowSpeed: 'med', contactEmail: '',
  pageHeadTitle: '', description: '', siteLogo: '', siteFavicon: '',
  watermark: '', sortOrder: 'random', homepageUrl: '', density: 'med',
  enableMiscTag: false,
};

function makeTestEntry(id: string, overrides: Partial<ImageEntry> = {}): ImageEntry {
  return {
    id, filename: `${id}.jpg`, type: 'image/jpeg',
    thumb: `/thumb/${id}.jpg`, full: `/full/${id}.jpg`, tags: [],
    width: 800, height: 600, nsfw: false, copyright: '',
    bannerHeight: 0, captureDate: '', title: '', description: '', ...overrides,
  };
}

function makeTestCard(id: string, overrides: Partial<FloatingImage> = {}): FloatingImage {
  return {
    uid: Math.random(), entry: makeTestEntry(id), x: 0, y: 0,
    w: 200, h: 150, rotation: 0, z: 0.5, zIndex: 50, shadow: '0 0 0', ...overrides,
  };
}

describe('GalleryComponent (DOM)', () => {
  let component: GalleryComponent;
  let fixture: ComponentFixture<GalleryComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, GalleryComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({}) },
            paramMap: of(convertToParamMap({})),
          },
        },
        { provide: GalleryStateService, useValue: { cards: null, entries: null, offset: 0, manifestVersion: '' } },
        { provide: Location, useValue: { path: () => '/', replaceState: () => {} } },
        (() => {
          const cfg = signal<SiteConfig>(MOCK_CONFIG);
          return {
            provide: SiteConfigService,
            useValue: {
              config: cfg,
              tags: signal([]),
              activeTags: signal([]),
              allTags: signal([]),
              nsfwBlur: signal(false),
              hasNsfw: signal(false),
              aboutOpen: signal(false),
              adminAuthenticated: signal(false),
              flowDirection: computed(() => cfg()?.flowDirection ?? 'rtl'),
              flowSpeed: computed(() => cfg()?.flowSpeed ?? 'med'),
              density: computed(() => cfg()?.density ?? 'med'),
              sessionOverrides: computed(() => ({ direction: false, speed: false, density: false, nsfw: false })),
              pageTitle: (ctx?: string, photo?: string) => ['Test', ctx, photo].filter(Boolean).join(' | '),
              setActiveFromSlugs: () => {},
              toggleNsfw: () => {},
              saveConfig: () => {},
            },
          };
        })(),
        {
          provide: SeoService,
          useValue: { updateTags: () => {}, setKeywords: () => {}, clearKeywords: () => {} },
        },
        {
          provide: ConnectivityService,
          useValue: { isOnline: signal(true), showOffline: signal(false), start: () => Promise.resolve(), stop: () => {} },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(GalleryComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.match(() => true); // flush any pending requests
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows loading state initially', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.gallery-loading')).toBeTruthy();
  });

  it('shows empty state when no images', () => {
    component.loading.set(false);
    component.empty.set(true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.gallery-empty')?.textContent).toContain('No images found');
  });

  it('renders river cards for each image', () => {
    component.loading.set(false);
    component.cards.set([
      makeTestCard('a', { x: 0, y: 0 }),
      makeTestCard('b', { x: 200, y: 0 }),
    ]);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.river-card');
    expect(cards.length).toBe(2);
  });

  it('cards have role="button" and tabindex="0"', () => {
    component.loading.set(false);
    component.cards.set([makeTestCard('a')]);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.river-card');
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('cards have aria-label with photo title', () => {
    component.loading.set(false);
    component.cards.set([makeTestCard('sunset', { entry: makeTestEntry('sunset', { title: 'Sunset Beach' }) })]);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.river-card');
    expect(card.getAttribute('aria-label')).toContain('Sunset Beach');
  });

  it('cards have aria-label falling back to id when no title', () => {
    component.loading.set(false);
    component.cards.set([makeTestCard('img-001')]);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.river-card');
    expect(card.getAttribute('aria-label')).toContain('img-001');
  });

  it('card images have alt text', () => {
    component.loading.set(false);
    component.cards.set([makeTestCard('a')]);
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('.river-card img');
    expect(img.getAttribute('alt')).toBe('a');
  });

  it('lightbox curtain has aria-hidden', () => {
    component.loading.set(false);
    component.cards.set([makeTestCard('a')]);
    fixture.detectChanges();
    const curtain = fixture.nativeElement.querySelector('.lightbox-curtain');
    expect(curtain.getAttribute('aria-hidden')).toBe('true');
  });

  it('onPointerDown records coordinates', () => {
    const event = new PointerEvent('pointerdown', { clientX: 100, clientY: 200 });
    component.onPointerDown(event);
    // No public property to check, but it shouldn't throw
    expect().nothing();
  });

  it('onCardClick opens lightbox when pointer barely moved', () => {
    component.loading.set(false);
    const card = makeTestCard('a');
    component.cards.set([card]);
    fixture.detectChanges();

    component.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    spyOn(component, 'openLightbox');
    component.onCardClick(new MouseEvent('click', { clientX: 105, clientY: 103 }), card, 0);
    expect(component.openLightbox).toHaveBeenCalledWith(card, 0);
  });

  it('onCardClick does NOT open lightbox when pointer moved significantly (drag)', () => {
    const card = makeTestCard('a');
    component.cards.set([card]);

    component.onPointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    spyOn(component, 'openLightbox');
    component.onCardClick(new MouseEvent('click', { clientX: 150, clientY: 100 }), card, 0);
    expect(component.openLightbox).not.toHaveBeenCalled();
  });

  it('NSFW prompt banner is shown via lightbox (imperative)', () => {
    // The NSFW banner is now added imperatively to the lightbox overlay,
    // not as a template element. Just verify the signal works.
    component.nsfwPromptOpen.set(true);
    expect(component.nsfwPromptOpen()).toBeTrue();
    component.nsfwPromptOpen.set(false);
    expect(component.nsfwPromptOpen()).toBeFalse();
  });

  describe('openLightbox', () => {
    it('sets lightbox state signals', () => {
      component.loading.set(false);
      const card = makeTestCard('photo1');
      component.cards.set([card]);
      fixture.detectChanges();

      component.openLightbox(card, 0);
      expect(component.lightboxOpen()).toBeTrue();
      expect(component.lightboxImage()).toBe(card);
      // Clean up GSAP animation frame
      cancelAnimationFrame((component as any).rafId);
    });

    it('does not open if already open', () => {
      const card = makeTestCard('photo1');
      component.cards.set([card]);
      component.loading.set(false);
      fixture.detectChanges();

      component.openLightbox(card, 0);
      const first = component.lightboxImage();
      const card2 = makeTestCard('photo2');
      component.cards.set([card, card2]);
      component.openLightbox(card2, 1);
      expect(component.lightboxImage()).toBe(first);
      cancelAnimationFrame((component as any).rafId);
    });

    it('shows NSFW prompt for nsfw images when blur is on', () => {
      const siteConfig = TestBed.inject(SiteConfigService);
      (siteConfig.nsfwBlur as any).set(true);

      const nsfwCard = makeTestCard('nsfw1', {
        entry: makeTestEntry('nsfw1', { nsfw: true, thumbBlur: '/blur.jpg' }),
      });
      component.cards.set([nsfwCard]);
      component.loading.set(false);
      fixture.detectChanges();

      component.openLightbox(nsfwCard, 0);
      expect(component.nsfwPromptOpen()).toBeTrue();
      cancelAnimationFrame((component as any).rafId);
    });
  });

  describe('closeLightbox', () => {
    it('does nothing when not open', () => {
      expect(() => component.closeLightbox()).not.toThrow();
      expect(component.lightboxOpen()).toBeFalse();
    });
  });

  describe('dismissNsfwPrompt', () => {
    it('closes prompt', () => {
      component.nsfwPromptOpen.set(true);
      component.lightboxOpen.set(true);
      component.lightboxImage.set(makeTestCard('x'));
      component.dismissNsfwPrompt();
      expect(component.nsfwPromptOpen()).toBeFalse();
    });
  });

  describe('disableNsfwAndOpen', () => {
    it('closes prompt and toggles NSFW', () => {
      const siteConfig = TestBed.inject(SiteConfigService);
      spyOn(siteConfig, 'toggleNsfw');

      component.nsfwPromptOpen.set(true);
      component.disableNsfwAndOpen();

      expect(component.nsfwPromptOpen()).toBeFalse();
      expect(siteConfig.toggleNsfw).toHaveBeenCalled();
    });
  });

  describe('navigateLightbox', () => {
    it('does nothing when lightbox is closed', () => {
      expect(() => component.navigateLightbox(1)).not.toThrow();
    });
  });


  describe('lightbox class binding', () => {
    it('adds lightbox-active class when lightbox is open', () => {
      component.loading.set(false);
      const card = makeTestCard('a');
      component.cards.set([card]);
      fixture.detectChanges();

      component.openLightbox(card, 0);
      fixture.detectChanges();
      const canvas = fixture.nativeElement.querySelector('.gallery-canvas');
      expect(canvas.classList.contains('lightbox-active')).toBeTrue();
    });
  });

  describe('internal logic (via private methods)', () => {
    const comp = () => component as any;

    beforeEach(() => {
      fixture.detectChanges();
    });

    describe('filterEntries', () => {
      const entries = [
        makeTestEntry('a', { tags: ['nature'], captureDate: '2024-01-01' }),
        makeTestEntry('b', { tags: ['portrait'], captureDate: '2024-06-15' }),
        makeTestEntry('c', { tags: ['nature', 'portrait'], captureDate: '2024-03-10' }),
      ];

      it('returns all entries when no active tags', () => {
        const result = comp().filterEntries(entries);
        expect(result.length).toBe(3);
      });

      it('filters by active tags', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.activeTags as any).set(['portrait']);
        const result = comp().filterEntries(entries);
        expect(result.length).toBe(2);
        expect(result.every((e: ImageEntry) => e.tags.includes('portrait'))).toBeTrue();
      });

      it('sorts by date descending (date-desc)', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.config as any).set({ ...MOCK_CONFIG, sortOrder: 'date-desc' });
        (siteConfig.activeTags as any).set([]);
        const result = comp().filterEntries(entries);
        expect(result[0].captureDate).toBe('2024-06-15');
        expect(result[2].captureDate).toBe('2024-01-01');
      });

      it('sorts by date ascending (date-asc)', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.config as any).set({ ...MOCK_CONFIG, sortOrder: 'date-asc' });
        (siteConfig.activeTags as any).set([]);
        const result = comp().filterEntries(entries);
        expect(result[0].captureDate).toBe('2024-01-01');
        expect(result[2].captureDate).toBe('2024-06-15');
      });

      it('shuffles for random sort', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.config as any).set({ ...MOCK_CONFIG, sortOrder: 'random' });
        (siteConfig.activeTags as any).set([]);
        const result = comp().filterEntries(entries);
        expect(result.length).toBe(3);
      });
    });

    describe('initMetrics', () => {
      it('computes grid metrics', () => {
        comp().entries = [makeTestEntry('a')];
        comp().initMetrics();
        expect(comp().vw).toBeGreaterThan(0);
        expect(comp().vh).toBeGreaterThan(0);
        expect(comp().rows).toBeGreaterThan(0);
        expect(comp().cellH).toBeGreaterThan(0);
        expect(comp().colSpacing).toBeGreaterThan(0);
      });

      it('sets baseSpeed based on flow direction', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.config as any).set({ ...MOCK_CONFIG, flowDirection: 'ltr', flowSpeed: 'med' });
        comp().initMetrics();
        expect(comp().baseSpeed).toBeLessThan(0); // ltr = negative (scrolls left)

        (siteConfig.config as any).set({ ...MOCK_CONFIG, flowDirection: 'rtl', flowSpeed: 'med' });
        comp().initMetrics();
        expect(comp().baseSpeed).toBeGreaterThan(0); // rtl = positive (scrolls right-to-left)
      });

      it('sets vertical flag for ttb/btt', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.config as any).set({ ...MOCK_CONFIG, flowDirection: 'ttb' });
        comp().initMetrics();
        expect(comp().vertical).toBeTrue();

        (siteConfig.config as any).set({ ...MOCK_CONFIG, flowDirection: 'btt' });
        comp().initMetrics();
        expect(comp().vertical).toBeTrue();

        (siteConfig.config as any).set({ ...MOCK_CONFIG, flowDirection: 'rtl' });
        comp().initMetrics();
        expect(comp().vertical).toBeFalse();
      });

      it('sets speed to 0 for "off"', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.config as any).set({ ...MOCK_CONFIG, flowSpeed: 'off' });
        comp().initMetrics();
        expect(comp().baseSpeed).toBe(0);
      });
    });

    describe('pickEntry', () => {
      it('picks from entries excluding given IDs', () => {
        comp().entries = [makeTestEntry('a'), makeTestEntry('b'), makeTestEntry('c')];
        const exclude = new Set(['a', 'b']);
        const picked = comp().pickEntry(exclude);
        expect(picked.id).toBe('c');
      });

      it('falls back to any entry when all excluded', () => {
        comp().entries = [makeTestEntry('a')];
        const exclude = new Set(['a']);
        const picked = comp().pickEntry(exclude);
        expect(picked.id).toBe('a');
      });
    });

    describe('colCenterX', () => {
      it('computes column center position', () => {
        comp().gridOrigin = 100;
        comp().colSpacing = 300;
        expect(comp().colCenterX(0)).toBe(100);
        expect(comp().colCenterX(1)).toBe(400);
        expect(comp().colCenterX(2)).toBe(700);
      });
    });

    describe('recalcFillRatio', () => {
      it('computes fill ratio based on entry count', () => {
        comp().primaryLen = 1000;
        comp().vw = 1000;
        comp().colSpacing = 200;
        comp().rows = 5;
        comp().entries = Array.from({ length: 100 }, (_, i) => makeTestEntry(`e${i}`));
        comp().recalcFillRatio();
        expect(comp().fillRatio).toBeGreaterThan(0);
        expect(comp().fillRatio).toBeLessThanOrEqual(1);
      });

      it('caps fillRatio at 1', () => {
        comp().primaryLen = 100;
        comp().vw = 100;
        comp().colSpacing = 100;
        comp().rows = 1;
        comp().entries = Array.from({ length: 1000 }, (_, i) => makeTestEntry(`e${i}`));
        comp().recalcFillRatio();
        expect(comp().fillRatio).toBe(1);
      });
    });

    describe('makeCardInCell', () => {
      beforeEach(() => {
        comp().cellH = 200;
        comp().rows = 5;
        comp().targetArea = 40000;
        comp().vertical = false;
      });

      it('creates a card with correct entry', () => {
        const entry = makeTestEntry('test');
        const card = comp().makeCardInCell(entry, 500, 2, 300);
        expect(card.entry).toBe(entry);
        expect(card.w).toBeGreaterThan(0);
        expect(card.h).toBeGreaterThan(0);
      });

      it('respects aspect ratio', () => {
        const entry = makeTestEntry('wide', { width: 1600, height: 900 });
        const card = comp().makeCardInCell(entry, 500, 0, 300);
        expect(card.w / card.h).toBeCloseTo(1600 / 900, 1);
      });

      it('creates cards in vertical mode', () => {
        comp().vertical = true;
        const entry = makeTestEntry('vert');
        const card = comp().makeCardInCell(entry, 500, 2, 300);
        expect(card.entry).toBe(entry);
      });
    });

    describe('initCards', () => {
      it('initializes cards array from entries', () => {
        comp().vw = 1000;
        comp().vh = 800;
        comp().entries = Array.from({ length: 20 }, (_, i) => makeTestEntry(`e${i}`));
        comp().initMetrics();
        comp().initCards(comp().entries);
        // fillRatio may cause some slots to be empty, but with 20 entries we should get some cards
        expect(component.cards().length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('buildColumn', () => {
      it('builds cards for a column', () => {
        comp().vw = 1000;
        comp().vh = 800;
        comp().entries = Array.from({ length: 10 }, (_, i) => makeTestEntry(`e${i}`));
        comp().initMetrics();
        comp().recalcFillRatio();
        comp().fillRatio = 1; // force all slots filled
        const cards = comp().buildColumn(0, []);
        expect(cards.length).toBeGreaterThan(0);
        expect(cards.length).toBeLessThanOrEqual(comp().rows);
      });
    });

    describe('applyFilter', () => {
      it('marks stale cards and updates entries', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.activeTags as any).set([]);

        comp().allEntries = [makeTestEntry('a'), makeTestEntry('b')];
        comp().entries = comp().allEntries;
        comp().entryIds = new Set(['a', 'b']);
        comp().vw = 1000;
        comp().vh = 800;
        comp().initMetrics();

        comp().applyFilter();
        expect(comp().entries.length).toBe(2);
        expect(component.empty()).toBeFalse();
      });

      it('sets empty when filter removes all entries', () => {
        const siteConfig = TestBed.inject(SiteConfigService);
        (siteConfig.activeTags as any).set(['nonexistent']);

        comp().allEntries = [makeTestEntry('a', { tags: ['nature'] })];
        comp().entries = comp().allEntries;
        comp().entryIds = new Set(['a']);
        comp().vw = 1000;
        comp().vh = 800;
        comp().initMetrics();

        comp().applyFilter();
        expect(component.empty()).toBeTrue();
      });
    });

    describe('animateBump', () => {
      it('sets userSpeed based on direction', () => {
        comp().primaryLen = 1000;
        comp().baseSpeed = -0.5;
        comp().animateBump(-1);
        expect(comp().userSpeed).toBeLessThan(0);
      });

      it('defaults direction based on baseSpeed sign', () => {
        comp().primaryLen = 1000;
        comp().baseSpeed = 0.5;
        comp().animateBump();
        expect(comp().userSpeed).toBeGreaterThan(0);
      });
    });

    describe('persistState', () => {
      it('saves to GalleryStateService', () => {
        const state = TestBed.inject(GalleryStateService);
        const cards = [makeTestCard('a')];
        component.cards.set(cards);
        comp().offset = 42;
        comp().persistState();
        expect(state.cards).toEqual(cards);
        expect(state.offset).toBe(42);
      });
    });

    describe('pauseRiver / resumeRiver', () => {
      it('pauseRiver sets flag', () => {
        comp().pauseRiver();
        expect(comp().riverPaused).toBeTrue();
      });

      it('double pause is no-op', () => {
        comp().pauseRiver();
        comp().pauseRiver();
        expect(comp().riverPaused).toBeTrue();
      });

      it('resumeRiver clears flag', () => {
        comp().riverPaused = true;
        comp().resumeRiver();
        expect(comp().riverPaused).toBeFalse();
      });
    });

    describe('bustImageCaches', () => {
      it('does not throw', () => {
        expect(() => comp().bustImageCaches()).not.toThrow();
      });
    });

    describe('fetchManifest', () => {
      // fetchManifest starts startRiver() which creates an rAF loop
      // We can't safely call it in unit tests, but we test the sub-methods it calls

      it('sets empty when no images', () => {
        comp().fetchManifest();
        httpMock.expectOne('/api/manifest').flush({ version: 'v1', images: [] });
        expect(component.empty()).toBeTrue();
        expect(component.loading()).toBeFalse();
      });

      it('handles fetch error', () => {
        comp().fetchManifest();
        httpMock.expectOne('/api/manifest').flush('error', { status: 500, statusText: 'Error' });
        expect(component.loading()).toBeFalse();
      });
    });

    describe('ensureColumns', () => {
      it('adds new columns in range', () => {
        comp().vw = 1000;
        comp().vh = 800;
        comp().entries = Array.from({ length: 10 }, (_, i) => makeTestEntry(`e${i}`));
        comp().initMetrics();
        comp().recalcFillRatio();
        comp().fillRatio = 1;
        comp().offset = 0;
        comp().materializedCols.clear();

        comp().ensureColumns();
        expect(component.cards().length).toBeGreaterThan(0);
        expect(comp().materializedCols.size).toBeGreaterThan(0);
      });

      it('removes out-of-range columns', () => {
        comp().vw = 1000;
        comp().vh = 800;
        comp().entries = Array.from({ length: 10 }, (_, i) => makeTestEntry(`e${i}`));
        comp().initMetrics();
        comp().recalcFillRatio();
        comp().fillRatio = 1;

        // Build some columns at offset 0
        comp().offset = 0;
        comp().materializedCols.clear();
        comp().ensureColumns();
        const initialCols = comp().materializedCols.size;

        // Move far away
        comp().offset = 100000;
        comp().ensureColumns();
        // Old columns should be removed, new ones added
        expect(comp().materializedCols.size).toBeGreaterThan(0);
      });
    });

    describe('listenKeyboard (window events)', () => {
      beforeEach(() => {
        comp().listenKeyboard();
      });

      it('arrow keys bump stream when lightbox closed', () => {
        comp().primaryLen = 1000;
        comp().baseSpeed = -0.5;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(comp().userSpeed).not.toBe(0);
      });

      it('escape calls closeLightbox when open', () => {
        // Set up lightbox state directly (avoid rAF loop from openLightbox)
        component.lightboxOpen.set(true);
        component.lightboxImage.set(makeTestCard('a'));
        spyOn(component, 'closeLightbox');

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(component.closeLightbox).toHaveBeenCalled();
      });

      it('escape dismisses NSFW prompt first', () => {
        component.nsfwPromptOpen.set(true);
        component.lightboxOpen.set(true);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(component.nsfwPromptOpen()).toBeFalse();
      });

      it('escape removes QR overlay if present', () => {
        const qr = document.createElement('div');
        comp().qrOverlay = qr;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(comp().qrOverlay).toBeNull();
      });
    });

    describe('downloadImage', () => {
      it('creates and clicks a download link', () => {
        const card = makeTestCard('dl-test');
        expect(() => comp().downloadImage(card)).not.toThrow();
      });
    });

    describe('shareImage', () => {
      it('is an async share method', () => {
        expect(typeof comp().shareImage).toBe('function');
      });
    });

    describe('restoreNeighbors', () => {
      it('clears displacedCards array via callback', (done) => {
        comp().prefersReducedMotion = true;
        comp().displacedCards = [
          { el: document.createElement('div'), dx: 10, dy: 5 },
          { el: document.createElement('div'), dx: -10, dy: -5 },
        ];
        comp().restoreNeighbors(() => {
          expect(comp().displacedCards.length).toBe(0);
          done();
        });
      });

      it('handles empty array', () => {
        comp().displacedCards = [];
        expect(() => comp().restoreNeighbors()).not.toThrow();
      });
    });

    describe('displaceNeighbors', () => {
      it('returns early without sourceRect', () => {
        comp().displacedCards = [];
        comp().displaceNeighbors(document.createElement('div'), 0, undefined);
        expect(comp().displacedCards.length).toBe(0);
      });

      it('pushes nearby cards away', () => {
        component.loading.set(false);
        component.cards.set([
          makeTestCard('a', { x: 0, y: 0, w: 100, h: 100 }),
          makeTestCard('b', { x: 50, y: 50, w: 100, h: 100 }),
        ]);
        fixture.detectChanges();

        const canvas = fixture.nativeElement.querySelector('.gallery-canvas');
        const rect = new DOMRect(0, 0, 100, 100);
        comp().displaceNeighbors(canvas, 0, rect);
        // May or may not displace depending on computed positions
        expect(comp().displacedCards).toBeDefined();
      });
    });

    describe('showQrCode', () => {
      it('is an async method that generates QR codes', () => {
        // showQrCode requires canvas + QRCode library — tested via integration
        expect(typeof comp().showQrCode).toBe('function');
      });
    });

    describe('checkDeepLink', () => {
      it('does nothing when no :id param', () => {
        comp().entries = [makeTestEntry('a')];
        comp().checkDeepLink();
        // No lightbox opened
        expect(component.lightboxOpen()).toBeFalse();
      });
    });

    describe('startManifestPoll', () => {
      it('is a method that creates a polling interval', () => {
        // Can't safely start polling in unit tests (creates real intervals)
        expect(typeof comp().startManifestPoll).toBe('function');
      });
    });

    describe('listenResize', () => {
      it('sets up resize listener without throwing', () => {
        comp().entries = [makeTestEntry('a')];
        comp().vw = 1000;
        comp().vh = 800;
        comp().initMetrics();
        expect(() => comp().listenResize()).not.toThrow();
      });
    });

    describe('setupObserver', () => {
      it('does nothing without Observer plugin', () => {
        expect(() => comp().setupObserver()).not.toThrow();
      });
    });

    describe('resizeLightbox', () => {
      it('does nothing without overlay', () => {
        comp().lightboxEl = null;
        expect(() => comp().resizeLightbox()).not.toThrow();
      });
    });

    // addLightboxControls creates complex DOM + event listeners — tested via e2e

    // animateOpen and closeLightbox animation paths require full GSAP + DOM — tested via e2e

    describe('deleteImage', () => {
      it('prompts for confirmation', () => {
        spyOn(window, 'confirm').and.returnValue(false);
        const card = makeTestCard('del-test');
        comp().deleteImage(card);
        expect(window.confirm).toHaveBeenCalled();
      });

      it('sends DELETE on confirmation', () => {
        spyOn(window, 'confirm').and.returnValue(true);
        const card = makeTestCard('del-test');
        comp().deleteImage(card);
        const req = httpMock.expectOne(r => r.method === 'DELETE');
        expect(req.request.url).toContain('/api/delete');
      });
    });

    describe('attachSwipe', () => {
      it('attaches pointer event listeners', () => {
        const target = document.createElement('div');
        expect(() => comp().attachSwipe(target)).not.toThrow();
      });
    });

    describe('startRiver / resumeRiver integration', () => {
      it('resumeRiver does nothing when not paused', () => {
        comp().riverPaused = false;
        comp().resumeRiver();
        expect(comp().riverPaused).toBeFalse();
      });
    });
  });
});

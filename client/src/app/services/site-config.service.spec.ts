import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { SiteConfigService, SiteConfig, slugify } from './site-config.service';

const MOCK_CONFIG: SiteConfig = {
  title: 'Test Gallery',
  subtitle: 'A test subtitle',
  headerColor: '#e2d6bb',

  bgColor: '#808080',
  fontBody: 'Raleway',
  nsfwBlurDefault: false,
  enabledTags: [],
  tagDisplayMode: 'nav',
  enableShare: true,
  enableDownload: true,
  enableQr: true,
  enableKiosk: true,
  flowDirection: 'rtl',
  flowSpeed: 'med',
  contactEmail: '',
  pageHeadTitle: '',
  description: '',
  siteLogo: '',
  siteFavicon: '',
  watermark: '',
  sortOrder: 'random',
  homepageUrl: '',
};

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Nature Photos')).toBe('nature-photos');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Black & White')).toBe('black-white');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('collapses multiple special characters into single hyphen', () => {
    expect(slugify('a!!!b')).toBe('a-b');
  });

  it('handles already-slugified input', () => {
    expect(slugify('already-slug')).toBe('already-slug');
  });

  it('handles unicode by stripping non-ascii', () => {
    expect(slugify('café')).toBe('caf');
  });
});

describe('SiteConfigService', () => {
  let service: SiteConfigService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        SiteConfigService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    service = TestBed.inject(SiteConfigService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initializes with null config', () => {
    expect(service.config()).toBeNull();
  });

  it('initializes with empty tags', () => {
    expect(service.allTags()).toEqual([]);
    expect(service.tags()).toEqual([]);
    expect(service.activeTags()).toEqual([]);
  });

  describe('pageTitle', () => {
    it('returns default title when config is null', () => {
      expect(service.pageTitle()).toBe('Pix Stream');
    });

    it('returns site title from config', () => {
      service.config.set(MOCK_CONFIG);
      expect(service.pageTitle()).toBe('Test Gallery');
    });

    it('appends pageHeadTitle when set', () => {
      service.config.set({ ...MOCK_CONFIG, pageHeadTitle: 'Portfolio' });
      expect(service.pageTitle()).toBe('Test Gallery | Portfolio');
    });

    it('appends context before pageHeadTitle', () => {
      service.config.set(MOCK_CONFIG);
      expect(service.pageTitle('About')).toBe('Test Gallery | About');
    });

    it('appends context and pageHeadTitle', () => {
      service.config.set({ ...MOCK_CONFIG, pageHeadTitle: 'Portfolio' });
      expect(service.pageTitle('Landscape')).toBe('Test Gallery | Landscape | Portfolio');
    });

    it('appends photo after pageHeadTitle', () => {
      service.config.set({ ...MOCK_CONFIG, pageHeadTitle: 'Portfolio' });
      expect(service.pageTitle(undefined, 'sunset.jpg')).toBe('Test Gallery | Portfolio | sunset.jpg');
    });

    it('includes context and photo together', () => {
      service.config.set({ ...MOCK_CONFIG, pageHeadTitle: 'Portfolio' });
      expect(service.pageTitle('Admin', 'sunset.jpg')).toBe('Test Gallery | Admin | Portfolio | sunset.jpg');
    });
  });

  describe('load', () => {
    it('fetches config, tags, and auth status', () => {
      service.load();

      const configReq = httpMock.expectOne('/api/config');
      const tagsReq = httpMock.expectOne('/api/tags');
      const authReq = httpMock.expectOne('/api/auth/status');

      configReq.flush(MOCK_CONFIG);
      tagsReq.flush(['nature', 'portrait']);
      authReq.flush({ setupRequired: false, authenticated: true });

      expect(service.config()).toEqual(MOCK_CONFIG);
      expect(service.allTags()).toEqual(['nature', 'portrait']);
      expect(service.adminAuthenticated()).toBeTrue();
      expect(service.adminSetupRequired()).toBeFalse();
    });

    it('sets tags signal from allTags when no enabledTags', () => {
      service.load();

      httpMock.expectOne('/api/config').flush(MOCK_CONFIG);
      httpMock.expectOne('/api/tags').flush(['a', 'b', 'c']);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      expect(service.tags()).toEqual(['a', 'b', 'c']);
    });

    it('filters tags when enabledTags is set', () => {
      service.load();

      httpMock.expectOne('/api/config').flush({ ...MOCK_CONFIG, enabledTags: ['a', 'c'] });
      httpMock.expectOne('/api/tags').flush(['a', 'b', 'c']);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      expect(service.tags()).toEqual(['a', 'c']);
    });

    it('sets meta description from subtitle', () => {
      const meta = TestBed.inject(Meta);
      service.load();

      httpMock.expectOne('/api/config').flush(MOCK_CONFIG);
      httpMock.expectOne('/api/tags').flush([]);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      const descTag = meta.getTag('name="description"');
      expect(descTag?.content).toBe('A test subtitle');
    });

    it('falls back to stripped description when no subtitle', () => {
      const meta = TestBed.inject(Meta);
      service.load();

      httpMock.expectOne('/api/config').flush({
        ...MOCK_CONFIG,
        subtitle: '',
        description: '**Bold** and _italic_ text',
      });
      httpMock.expectOne('/api/tags').flush([]);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      const descTag = meta.getTag('name="description"');
      expect(descTag?.content).toBe('Bold and italic text');
    });

    it('sets page title from config', () => {
      const title = TestBed.inject(Title);
      service.load();

      httpMock.expectOne('/api/config').flush(MOCK_CONFIG);
      httpMock.expectOne('/api/tags').flush([]);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      expect(title.getTitle()).toBe('Test Gallery');
    });
  });

  describe('toggleNsfw', () => {
    it('toggles nsfwBlur signal', () => {
      const initial = service.nsfwBlur();
      service.toggleNsfw();
      expect(service.nsfwBlur()).toBe(!initial);
    });

    it('toggles back', () => {
      const initial = service.nsfwBlur();
      service.toggleNsfw();
      service.toggleNsfw();
      expect(service.nsfwBlur()).toBe(initial);
    });

    it('persists to localStorage', () => {
      service.toggleNsfw();
      const stored = localStorage.getItem('nsfw-blur');
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!)).toBe(service.nsfwBlur());
    });
  });

  describe('setActiveFromSlugs', () => {
    it('resolves slugs against known tags', () => {
      // Simulate tags being loaded
      service.tags.set(['Nature', 'Black & White', 'Portrait']);
      service.setActiveFromSlugs(['black-white']);
      expect(service.activeTags()).toEqual(['Black & White']);
    });

    it('passes through unrecognized slugs as-is', () => {
      service.tags.set(['Nature']);
      service.setActiveFromSlugs(['unknown-tag']);
      expect(service.activeTags()).toEqual(['unknown-tag']);
    });

    it('queues slugs if tags not yet loaded', () => {
      // tags() is empty — slugs should be pending
      service.setActiveFromSlugs(['nature']);
      expect(service.activeTags()).toEqual([]);

      // Now simulate tags loading via load()
      service.load();
      httpMock.expectOne('/api/config').flush(MOCK_CONFIG);
      httpMock.expectOne('/api/tags').flush(['Nature', 'Portrait']);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      // Pending slugs should now resolve
      expect(service.activeTags()).toEqual(['Nature']);
    });
  });

  describe('saveConfig', () => {
    it('sends PUT and updates config signal', () => {
      service.load();
      httpMock.expectOne('/api/config').flush(MOCK_CONFIG);
      httpMock.expectOne('/api/tags').flush([]);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      const updated = { ...MOCK_CONFIG, title: 'Updated' };
      service.saveConfig({ title: 'Updated' });
      httpMock.expectOne({ method: 'PUT', url: '/api/config' }).flush(updated);

      expect(service.config()!.title).toBe('Updated');
    });
  });

  describe('theme application (via load)', () => {
    function loadWithConfig(svc: SiteConfigService, mock: HttpTestingController, config: Partial<SiteConfig>) {
      svc.load();
      mock.expectOne('/api/config').flush({ ...MOCK_CONFIG, ...config });
      mock.expectOne('/api/tags').flush([]);
      mock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });
    }

    it('applies header color as CSS variable', () => {
      loadWithConfig(service, httpMock, { headerColor: '#ff0000' });
      expect(document.documentElement.style.getPropertyValue('--color-header')).toBe('#ff0000');
    });

    it('sets dark header text for light header color', () => {
      loadWithConfig(service, httpMock, { headerColor: '#ffffff' });
      expect(document.documentElement.style.getPropertyValue('--color-header-text')).toBe('#222');
    });

    it('sets light header text for dark header color', () => {
      loadWithConfig(service, httpMock, { headerColor: '#111111' });
      expect(document.documentElement.style.getPropertyValue('--color-header-text')).toBe('#fafafa');
    });

    it('applies background color as clamped HSL', () => {
      loadWithConfig(service, httpMock, { bgColor: '#000000' });
      const bg = document.documentElement.style.getPropertyValue('--color-bg');
      expect(bg).toContain('hsl');
      // Black (#000) should be clamped to at least 20% lightness
      expect(bg).toContain('20%');
    });

    it('applies header glow for mid-lightness header', () => {
      loadWithConfig(service, httpMock, { headerColor: '#808080' }); // 50% lightness
      const glow = document.documentElement.style.getPropertyValue('--color-header-glow');
      expect(glow).toContain('rgba');
    });

    it('no header glow for very dark header', () => {
      loadWithConfig(service, httpMock, { headerColor: '#111111' });
      const glow = document.documentElement.style.getPropertyValue('--color-header-glow');
      expect(glow).toBe('none');
    });

    it('applies text shadow for mid-lightness backgrounds', () => {
      loadWithConfig(service, httpMock, { bgColor: '#808080' }); // ~50% lightness
      const shadow = document.documentElement.style.getPropertyValue('--color-text-shadow');
      expect(shadow).toContain('rgba');
    });

    it('no text shadow for extreme lightness backgrounds', () => {
      loadWithConfig(service, httpMock, { bgColor: '#111111' });
      const shadow = document.documentElement.style.getPropertyValue('--color-text-shadow');
      expect(shadow).toBe('none');
    });

    it('loads non-default fonts via link element', () => {
      const before = document.querySelectorAll('link[href*="fonts.googleapis"]').length;
      loadWithConfig(service, httpMock, { fontBody: 'Inter' });
      const after = document.querySelectorAll('link[href*="fonts.googleapis"]').length;
      expect(after).toBeGreaterThan(before);
    });

    it('does not load default font (Raleway)', () => {
      const before = document.querySelectorAll('link[href*="fonts.googleapis"]').length;
      loadWithConfig(service, httpMock, { fontBody: 'Raleway' });
      const after = document.querySelectorAll('link[href*="fonts.googleapis"]').length;
      expect(after).toBe(before);
    });

    it('applies favicon from config', () => {
      loadWithConfig(service, httpMock, { siteFavicon: '/custom-icon.svg' });
      const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      expect(link?.href).toContain('custom-icon.svg');
    });

    it('falls back to default favicon when empty', () => {
      loadWithConfig(service, httpMock, { siteFavicon: '' });
      const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      expect(link?.href).toContain('favicon.svg');
    });

    it('uses image/x-icon for .ico favicons', () => {
      loadWithConfig(service, httpMock, { siteFavicon: '/icon.ico' });
      const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      expect(link?.type).toBe('image/x-icon');
    });

    it('handles green-dominant header color (hexToHsl green branch)', () => {
      loadWithConfig(service, httpMock, { headerColor: '#00ff00' });
      expect(document.documentElement.style.getPropertyValue('--color-header')).toBe('#00ff00');
    });

    it('handles blue-dominant header color (hexToHsl blue branch)', () => {
      loadWithConfig(service, httpMock, { headerColor: '#0000ff' });
      expect(document.documentElement.style.getPropertyValue('--color-header')).toBe('#0000ff');
    });

    it('handles red-dominant with g < b (hexToHsl wrap branch)', () => {
      loadWithConfig(service, httpMock, { headerColor: '#ff00ff' }); // magenta: r=max, g<b
      expect(document.documentElement.style.getPropertyValue('--color-header')).toBe('#ff00ff');
    });

    it('sets light text for dark backgrounds', () => {
      loadWithConfig(service, httpMock, { bgColor: '#333333' });
      expect(document.documentElement.style.getPropertyValue('--color-text')).toBe('#fafafa');
    });

    it('sets dark text for light backgrounds', () => {
      loadWithConfig(service, httpMock, { bgColor: '#dddddd' });
      expect(document.documentElement.style.getPropertyValue('--color-text')).toBe('#222');
    });
  });

  describe('tag filtering edge cases', () => {
    it('re-filters when config arrives after tags', () => {
      service.load();

      // Tags arrive first
      httpMock.expectOne('/api/tags').flush(['a', 'b', 'c']);
      httpMock.expectOne('/api/auth/status').flush({ setupRequired: false, authenticated: false });

      // Config arrives with enabled tags
      httpMock.expectOne('/api/config').flush({ ...MOCK_CONFIG, enabledTags: ['a'] });

      expect(service.tags()).toEqual(['a']);
    });
  });

  describe('nsfwBlur persistence', () => {
    it('persists and reads from localStorage via toggleNsfw', () => {
      // Toggle NSFW off, verify it persists
      if (service.nsfwBlur()) service.toggleNsfw(); // set to false
      expect(localStorage.getItem('nsfw-blur')).toBe('false');
      service.toggleNsfw(); // set back to true
      expect(localStorage.getItem('nsfw-blur')).toBe('true');
    });
  });
});

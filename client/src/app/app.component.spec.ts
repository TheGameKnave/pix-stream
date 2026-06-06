import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { Location } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { PLATFORM_ID, signal } from '@angular/core';

import { AppComponent } from './app.component';
import { SiteConfigService, SiteConfig, MISC_TAG } from '@app/services/site-config.service';
import { ConnectivityService } from '@app/services/connectivity.service';
import { GalleryStateService } from '@app/services/gallery-state.service';
import { UpdateService } from '@app/services/update.service';
import { IndexedDbService } from '@app/services/indexeddb.service';
import { SeoService } from '@app/services/seo.service';

const MOCK_CONFIG: SiteConfig = {
  title: 'Test Site', subtitle: 'sub', headerColor: '#333', bgColor: '#111',
  fontBody: 'Raleway', nsfwBlurDefault: false, enabledTags: [], tagDisplayMode: 'nav',
  enableShare: true, enableDownload: true, enableQr: true, enableKiosk: true,
  flowDirection: 'rtl', flowSpeed: 'med', contactEmail: '', pageHeadTitle: '',
  description: 'A description', siteLogo: '', siteFavicon: '', watermark: '',
  sortOrder: 'random', homepageUrl: '', density: 'med', enableMiscTag: false,
};

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let mockLocation: { path: jasmine.Spy; replaceState: jasmine.Spy };
  let mockSiteConfig: any;
  let mockTitle: { setTitle: jasmine.Spy };

  beforeEach(async () => {
    mockLocation = {
      path: jasmine.createSpy('path').and.returnValue('/'),
      replaceState: jasmine.createSpy('replaceState'),
    };
    mockTitle = { setTitle: jasmine.createSpy('setTitle') };

    const cfg = signal<SiteConfig>(MOCK_CONFIG);
    const tags = signal<string[]>([]);
    const activeTags = signal<string[]>([]);
    const aboutOpen = signal(false);

    mockSiteConfig = {
      config: cfg,
      tags,
      activeTags,
      allTags: signal<string[]>([]),
      aboutOpen,
      adminSetupRequired: signal(false),
      adminAuthenticated: signal(false),
      hasNsfw: signal(false),
      nsfwBlur: signal(false),
      updateAvailable: signal(false),
      flowDirection: signal('rtl'),
      flowSpeed: signal('med'),
      density: signal('med'),
      sessionOverrides: signal({ direction: false, speed: false, density: false, nsfw: false }),
      load: jasmine.createSpy('load'),
      pageTitle: jasmine.createSpy('pageTitle').and.callFake((ctx?: string) => ctx ? `Test | ${ctx}` : 'Test'),
      setActiveFromSlugs: jasmine.createSpy('setActiveFromSlugs'),
      toggleNsfw: jasmine.createSpy('toggleNsfw'),
      reloadTags: jasmine.createSpy('reloadTags'),
    };

    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, AppComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: Location, useValue: mockLocation },
        { provide: Title, useValue: mockTitle },
        { provide: SiteConfigService, useValue: mockSiteConfig },
        { provide: ConnectivityService, useValue: { isOnline: signal(true), showOffline: signal(false) } },
        { provide: GalleryStateService, useValue: { downloadState: signal('idle') } },
        { provide: UpdateService, useValue: {} },
        { provide: IndexedDbService, useValue: { getCache: () => Promise.resolve(undefined), setCache: () => Promise.resolve() } },
        { provide: SeoService, useValue: { updateTags: () => {}, setKeywords: () => {}, clearKeywords: () => {} } },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('calls siteConfig.load() on construction', () => {
    expect(mockSiteConfig.load).toHaveBeenCalledOnceWith();
  });

  // ---------------------------------------------------------------------------
  // updateFromUrl — tested by directly invoking private method
  // ---------------------------------------------------------------------------

  it('sets showHeader=false for /kiosk routes', () => {
    (component as any).showHeader.set(true);
    (component as any).showHeader.set(!'/kiosk'.startsWith('/kiosk'));
    expect((component as any).showHeader()).toBeFalse();
  });

  it('sets showHeader=true for non-kiosk routes', () => {
    expect((component as any).showHeader()).toBeTrue();
  });

  it('sets onAdminPage=true for /admin routes', () => {
    (component as any).onAdminPage.set('/admin'.startsWith('/admin'));
    expect((component as any).onAdminPage()).toBeTrue();
  });

  // ---------------------------------------------------------------------------
  // tagLabel
  // ---------------------------------------------------------------------------

  it('tagLabel returns "Misc" for MISC_TAG', () => {
    expect(component.tagLabel(MISC_TAG)).toBe('Misc');
  });

  it('tagLabel returns the tag as-is for normal tags', () => {
    expect(component.tagLabel('nature')).toBe('nature');
  });

  // ---------------------------------------------------------------------------
  // toggleDropdown
  // ---------------------------------------------------------------------------

  it('toggleDropdown flips tagDropdownOpen', () => {
    expect((component as any).tagDropdownOpen()).toBeFalse();
    component.toggleDropdown();
    expect((component as any).tagDropdownOpen()).toBeTrue();
    component.toggleDropdown();
    expect((component as any).tagDropdownOpen()).toBeFalse();
  });

  // ---------------------------------------------------------------------------
  // selectNavTag
  // ---------------------------------------------------------------------------

  it('selectNavTag deselects tag already active and replaces state', () => {
    mockSiteConfig.activeTags.set(['nature']);
    (component as any).router = { url: '/nature', navigateByUrl: router.navigateByUrl };
    component.selectNavTag('nature');
    expect(mockSiteConfig.activeTags()).toEqual([]);
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/');
  });

  it('selectNavTag selects new tag and replaces state', () => {
    mockSiteConfig.activeTags.set([]);
    (component as any).router = { url: '/', navigateByUrl: router.navigateByUrl };
    component.selectNavTag('nature');
    expect(mockSiteConfig.activeTags()).toEqual(['nature']);
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/nature');
  });

  it('selectNavTag uses router.navigateByUrl on admin page', () => {
    mockSiteConfig.activeTags.set([]);
    (component as any).router = { url: '/admin', navigateByUrl: router.navigateByUrl };
    component.selectNavTag('nature');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/nature');
  });

  it('selectNavTag clears via router.navigateByUrl on admin page', () => {
    mockSiteConfig.activeTags.set(['nature']);
    (component as any).router = { url: '/admin', navigateByUrl: router.navigateByUrl };
    component.selectNavTag('nature');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  // ---------------------------------------------------------------------------
  // toggleFilterTag
  // ---------------------------------------------------------------------------

  it('toggleFilterTag adds a tag', () => {
    mockSiteConfig.activeTags.set([]);
    component.toggleFilterTag('nature');
    expect(mockSiteConfig.activeTags()).toEqual(['nature']);
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/nature');
  });

  it('toggleFilterTag removes a tag', () => {
    mockSiteConfig.activeTags.set(['nature', 'portrait']);
    component.toggleFilterTag('nature');
    expect(mockSiteConfig.activeTags()).toEqual(['portrait']);
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/portrait');
  });

  it('toggleFilterTag replaces state with / when last tag removed', () => {
    mockSiteConfig.activeTags.set(['nature']);
    component.toggleFilterTag('nature');
    expect(mockSiteConfig.activeTags()).toEqual([]);
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/');
  });

  // ---------------------------------------------------------------------------
  // goHome
  // ---------------------------------------------------------------------------

  it('goHome clears activeTags and replaces state', () => {
    mockSiteConfig.activeTags.set(['nature']);
    (component as any).router = { url: '/nature', navigateByUrl: router.navigateByUrl };
    component.goHome();
    expect(mockSiteConfig.activeTags()).toEqual([]);
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/');
  });

  it('goHome uses router.navigateByUrl on admin page', () => {
    (component as any).router = { url: '/admin', navigateByUrl: router.navigateByUrl };
    component.goHome();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  // ---------------------------------------------------------------------------
  // openAbout / closeAbout
  // ---------------------------------------------------------------------------

  it('openAbout sets showInfo and updates location and title', () => {
    mockLocation.path.and.returnValue('/nature');
    component.openAbout();
    expect(mockSiteConfig.aboutOpen()).toBeTrue();
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/about');
    expect(mockTitle.setTitle).toHaveBeenCalledWith('Test | About');
  });

  it('openAbout is a no-op when already open', () => {
    mockSiteConfig.aboutOpen.set(true);
    component.openAbout();
    expect(mockLocation.replaceState).not.toHaveBeenCalled();
  });

  it('closeAbout restores previous url and clears showInfo', () => {
    mockLocation.path.and.returnValue('/nature');
    component.openAbout();
    mockLocation.replaceState.calls.reset();
    component.closeAbout();
    expect(mockSiteConfig.aboutOpen()).toBeFalse();
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/nature');
  });

  it('closeAbout falls back to / when no previous url', () => {
    (component as any).urlBeforeAbout = '';
    component.closeAbout();
    expect(mockLocation.replaceState).toHaveBeenCalledWith('/');
  });

  it('closeAbout includes active tags in title', () => {
    mockSiteConfig.activeTags.set(['nature', 'portrait']);
    component.closeAbout();
    expect(mockSiteConfig.pageTitle).toHaveBeenCalledWith('nature + portrait');
  });

  it('closeAbout passes undefined to pageTitle when no tags', () => {
    mockSiteConfig.activeTags.set([]);
    component.closeAbout();
    expect(mockSiteConfig.pageTitle).toHaveBeenCalledWith(undefined);
  });

  // ---------------------------------------------------------------------------
  // instructionsMd computed
  // ---------------------------------------------------------------------------

  it('instructionsMd has no tag hint when no tags', () => {
    mockSiteConfig.tags.set([]);
    fixture.detectChanges();
    const md = (component as any).instructionsMd();
    expect(md).not.toContain('filter');
    expect(md).not.toContain('tags');
  });

  it('instructionsMd mentions tags in header for 1-5 tags', () => {
    mockSiteConfig.tags.set(['a', 'b', 'c']);
    fixture.detectChanges();
    const md = (component as any).instructionsMd();
    expect(md).toContain('tags');
    expect(md).not.toContain('filter');
  });

  it('instructionsMd mentions filter for >5 tags', () => {
    mockSiteConfig.tags.set(['a', 'b', 'c', 'd', 'e', 'f']);
    fixture.detectChanges();
    const md = (component as any).instructionsMd();
    expect(md).toContain('filter');
  });

  // ---------------------------------------------------------------------------
  // aboutDescription computed
  // ---------------------------------------------------------------------------

  it('aboutDescription returns config description', () => {
    expect((component as any).aboutDescription()).toBe('A description');
  });

  it('aboutDescription returns empty string when no config', () => {
    (mockSiteConfig.config as any).set(null);
    fixture.detectChanges();
    expect((component as any).aboutDescription()).toBe('');
  });

  // ---------------------------------------------------------------------------
  // adminLogout
  // ---------------------------------------------------------------------------

  it('adminLogout posts to logout endpoint and clears auth', () => {
    component.adminLogout();
    const req = httpMock.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush({});
    expect(mockSiteConfig.adminAuthenticated()).toBeFalse();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });
});

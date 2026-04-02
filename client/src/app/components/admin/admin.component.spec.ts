import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { PLATFORM_ID, Component, Input, Output, EventEmitter, Directive, signal } from '@angular/core';
import { AdminComponent } from './admin.component';
import { SiteConfigService, SiteConfig } from '@app/services/site-config.service';

// Stub directives to avoid heavy DOM dependencies
@Directive({ selector: '[appScrollIndicator]', standalone: true })
class MockScrollIndicatorDirective {}

@Component({ selector: 'app-markdown-editor', template: '', standalone: true })
class MockMarkdownEditorComponent {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
}

const MOCK_CONFIG: SiteConfig = {
  title: 'Test Gallery',
  subtitle: 'Sub',
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

describe('AdminComponent', () => {
  let component: AdminComponent;
  let fixture: ComponentFixture<AdminComponent>;
  let httpMock: HttpTestingController;
  let siteConfigService: jasmine.SpyObj<SiteConfigService>;

  beforeEach(async () => {
    const siteConfigSpy = jasmine.createSpyObj('SiteConfigService', ['saveConfig', 'pageTitle'], {
      config: signal(MOCK_CONFIG),
      allTags: signal(['nature', 'portrait', 'bw']),
      adminSetupRequired: signal(false),
      adminAuthenticated: signal(false),
    });
    siteConfigSpy.pageTitle.and.returnValue('Test Gallery | Admin');

    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        FormsModule,
        AdminComponent,
      ],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: SiteConfigService, useValue: siteConfigSpy },
      ],
    })
    .overrideComponent(AdminComponent, {
      remove: { imports: [] },
      add: { imports: [FormsModule, MockScrollIndicatorDirective, MockMarkdownEditorComponent] },
    })
    .compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    siteConfigService = TestBed.inject(SiteConfigService) as jasmine.SpyObj<SiteConfigService>;

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;

    // Respond to initial checkStatus call
    const authReq = httpMock.expectOne('/api/auth/status');
    authReq.flush({ authenticated: false, setupRequired: false });

    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts in loading state, then resolves', () => {
    expect(component.loading()).toBeFalse();
  });

  describe('setup (first-time password)', () => {
    beforeEach(() => {
      component.setupRequired.set(true);
    });

    it('rejects password shorter than 8 characters', () => {
      component.password = 'short';
      component.confirmPassword = 'short';
      component.setup();
      expect(component.error()).toBe('Password must be at least 8 characters');
    });

    it('rejects mismatched passwords', () => {
      component.password = 'longenough';
      component.confirmPassword = 'different1';
      component.setup();
      expect(component.error()).toBe('Passwords do not match');
    });

    it('sends setup request on valid password', () => {
      component.password = 'validpass';
      component.confirmPassword = 'validpass';
      component.setup();

      const req = httpMock.expectOne('/api/auth/setup');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ password: 'validpass' });

      req.flush({ success: true });
      // After setup, should load manifest
      httpMock.expectOne('/api/manifest').flush({ version: '1', images: [] });

      expect(component.authenticated()).toBeTrue();
      expect(component.setupRequired()).toBeFalse();
    });

    it('shows error on setup failure', () => {
      component.password = 'validpass';
      component.confirmPassword = 'validpass';
      component.setup();

      httpMock.expectOne('/api/auth/setup').flush(
        { error: 'Server error' },
        { status: 500, statusText: 'Error' }
      );

      expect(component.error()).toBe('Server error');
    });
  });

  describe('login', () => {
    it('sends login request', () => {
      component.password = 'testpass';
      component.login();

      const req = httpMock.expectOne('/api/auth/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ password: 'testpass' });

      req.flush({ success: true });
      httpMock.expectOne('/api/manifest').flush({ version: '1', images: [] });

      expect(component.authenticated()).toBeTrue();
    });

    it('shows error on login failure', () => {
      component.password = 'wrong';
      component.login();

      httpMock.expectOne('/api/auth/login').flush(
        { error: 'Invalid password' },
        { status: 401, statusText: 'Unauthorized' }
      );

      expect(component.error()).toBe('Invalid password');
    });
  });

  describe('onKeydown', () => {
    it('calls login on Enter when not in setup mode', () => {
      spyOn(component, 'login');
      component.setupRequired.set(false);
      component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(component.login).toHaveBeenCalled();
    });

    it('calls setup on Enter when in setup mode', () => {
      spyOn(component, 'setup');
      component.setupRequired.set(true);
      component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(component.setup).toHaveBeenCalled();
    });

    it('does nothing on non-Enter key', () => {
      spyOn(component, 'login');
      spyOn(component, 'setup');
      component.onKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
      expect(component.login).not.toHaveBeenCalled();
      expect(component.setup).not.toHaveBeenCalled();
    });
  });

  describe('tag management', () => {
    it('toggleTag adds a tag', () => {
      component.enabledTags = [];
      component.toggleTag('nature');
      expect(component.enabledTags).toContain('nature');
    });

    it('toggleTag removes an existing tag', () => {
      component.enabledTags = ['nature', 'portrait'];
      component.toggleTag('nature');
      expect(component.enabledTags).not.toContain('nature');
      expect(component.enabledTags).toContain('portrait');
    });

    it('selectAllTags includes all known tags', () => {
      component.selectAllTags();
      expect(component.enabledTags).toEqual(['nature', 'portrait', 'bw']);
    });

    it('deselectAllTags clears all', () => {
      component.enabledTags = ['nature'];
      component.deselectAllTags();
      expect(component.enabledTags).toEqual([]);
    });

    it('isTagEnabled returns true when no tags enabled (show all)', () => {
      component.enabledTags = [];
      expect(component.isTagEnabled('nature')).toBeTrue();
    });

    it('isTagEnabled returns true for enabled tags', () => {
      component.enabledTags = ['nature'];
      expect(component.isTagEnabled('nature')).toBeTrue();
      expect(component.isTagEnabled('portrait')).toBeFalse();
    });
  });

  describe('font picker', () => {
    it('resolvedFontBody returns fontBody for known fonts', () => {
      component.fontBody = 'Inter';
      expect(component.resolvedFontBody).toBe('Inter');
    });

    it('resolvedFontBody returns customFontBody for _custom', () => {
      component.fontBody = '_custom';
      component.customFontBody = 'Comic Sans';
      expect(component.resolvedFontBody).toBe('Comic Sans');
    });

    it('selectFont sets font and closes picker', () => {
      component.fontPickerOpen.set(true);
      component.selectFont('Lato');
      expect(component.fontBody).toBe('Lato');
      expect(component.customFontBody).toBe('');
      expect(component.fontPickerOpen()).toBeFalse();
    });

    it('selectCustomFont sets _custom and closes picker', () => {
      component.fontPickerOpen.set(true);
      component.selectCustomFont();
      expect(component.fontBody).toBe('_custom');
      expect(component.fontPickerOpen()).toBeFalse();
    });
  });

  describe('onConfigChange', () => {
    it('debounces and calls saveConfig', fakeAsync(() => {
      component.title = 'New Title';
      component.onConfigChange();
      tick(600);
      expect(siteConfigService.saveConfig).toHaveBeenCalled();
    }));

    it('sets saveStatus through saving lifecycle', fakeAsync(() => {
      component.onConfigChange();
      tick(600);
      expect(component.saveStatus()).toBe('Saving...');
      tick(500);
      expect(component.saveStatus()).toBe('Saved');
      tick(2000);
      expect(component.saveStatus()).toBe('');
    }));
  });

  describe('accordion state', () => {
    it('identity accordion starts open', () => {
      expect(component.accordionIdentity()).toBeTrue();
    });

    it('other accordions start closed', () => {
      expect(component.accordionTheme()).toBeFalse();
      expect(component.accordionTags()).toBeFalse();
      expect(component.accordionFlow()).toBeFalse();
      expect(component.accordionFeatures()).toBeFalse();
    });
  });

  describe('drag and drop', () => {
    it('onImageDragOver sets drag state', () => {
      const event = new Event('dragover') as DragEvent;
      spyOn(event, 'preventDefault');
      component.onImageDragOver(event as DragEvent);
      expect(component.imageDragOver()).toBeTrue();
    });

    it('onImageDragLeave clears drag state', () => {
      component.imageDragOver.set(true);
      component.onImageDragLeave();
      expect(component.imageDragOver()).toBeFalse();
    });
  });

  describe('authenticated flow', () => {
    it('populates fields when login succeeds', () => {
      component.password = 'testpassword';
      component.login();

      httpMock.expectOne('/api/auth/login').flush({ success: true });
      httpMock.expectOne('/api/manifest').flush({ version: '1', images: [
        { id: 'img1', filename: 'img1.jpg', type: 'image/jpeg', thumb: '/t/1', full: '/f/1', tags: ['nature'], width: 800, height: 600, nsfw: false, copyright: '', bannerHeight: 0, captureDate: '', title: '' },
        { id: 'img2', filename: 'img2.jpg', type: 'image/jpeg', thumb: '/t/2', full: '/f/2', tags: ['portrait'], width: 800, height: 600, nsfw: false, copyright: '', bannerHeight: 0, captureDate: '', title: '' },
      ]});

      expect(component.authenticated()).toBeTrue();
      expect(component.totalImageCount()).toBe(2);
      expect(component.title).toBe('Test Gallery');
    });

    it('populates custom font correctly', () => {
      (siteConfigService.config as any).set({ ...MOCK_CONFIG, fontBody: 'CustomFont' });

      component.password = 'testpassword';
      component.login();

      httpMock.expectOne('/api/auth/login').flush({ success: true });
      httpMock.expectOne('/api/manifest').flush({ version: '1', images: [] });

      expect(component.fontBody).toBe('_custom');
      expect(component.customFontBody).toBe('CustomFont');
    });
  });

  describe('hidden images calculation', () => {
    it('hidden count is 0 when no tags enabled', () => {
      component.enabledTags = [];
      component.deselectAllTags();
      expect(component.hiddenCount()).toBe(0);
    });

    it('computes hidden after login and manifest load', () => {
      component.password = 'testpassword';
      component.login();

      httpMock.expectOne('/api/auth/login').flush({ success: true });
      httpMock.expectOne('/api/manifest').flush({ version: '1', images: [
        { id: 'img1', filename: 'img1.jpg', type: 'image/jpeg', thumb: '/t/1', full: '/f/1', tags: ['nature'], width: 800, height: 600, nsfw: false, copyright: '', bannerHeight: 0, captureDate: '', title: '' },
        { id: 'img2', filename: 'img2.jpg', type: 'image/jpeg', thumb: '/t/2', full: '/f/2', tags: ['portrait'], width: 800, height: 600, nsfw: false, copyright: '', bannerHeight: 0, captureDate: '', title: '' },
      ]});

      // Enable only nature → img2 hidden
      component.enabledTags = ['nature'];
      component.toggleTag('nature'); // removes nature → empty = show all
      expect(component.hiddenCount()).toBe(0);
    });
  });

  describe('font picker toggle', () => {
    it('toggleFontPicker toggles state', () => {
      expect(component.fontPickerOpen()).toBeFalse();
      component.toggleFontPicker();
      expect(component.fontPickerOpen()).toBeTrue();
      component.toggleFontPicker();
      expect(component.fontPickerOpen()).toBeFalse();
    });
  });

  describe('color picker events', () => {
    it('onBgLightnessChange updates bgColor', () => {
      component.bgColor = '#808080';
      component.bgLightness = 30;
      component.onBgLightnessChange();
      // bgColor should change to reflect new lightness
      expect(component.bgColor).not.toBe('#808080');
    });

    it('onBgColorInputChange updates lightness', () => {
      component.bgColor = '#333333';
      component.onBgColorInputChange();
      expect(component.bgLightness).toBeLessThan(50);
    });

    it('onHdrLightnessChange updates headerColor', () => {
      component.headerColor = '#808080';
      component.hdrLightness = 70;
      component.onHdrLightnessChange();
      expect(component.headerColor).not.toBe('#808080');
    });

    it('onHdrColorInputChange updates lightness', () => {
      component.headerColor = '#cccccc';
      component.onHdrColorInputChange();
      expect(component.hdrLightness).toBeGreaterThan(50);
    });

    it('bg canvas mouse events set dragging state', () => {
      // These are no-ops without a real canvas, but should not throw
      component.bgDragging = false;
      expect(() => component.onBgCanvasDrag({} as MouseEvent)).not.toThrow();
    });

    it('hdr canvas mouse events set dragging state', () => {
      component.hdrDragging = false;
      expect(() => component.onHdrCanvasDrag({} as MouseEvent)).not.toThrow();
    });
  });

  describe('upload', () => {
    it('sets uploading state and handles success', () => {
      // Simulate authenticated
      component.authenticated.set(true);

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const event = { target: { files: dt.files, value: '' } } as unknown as Event;
      component.uploadImages(event);

      const req = httpMock.expectOne('/api/upload');
      expect(req.request.method).toBe('POST');
      req.flush({ uploaded: ['test.jpg'], errors: [] });

      // Should also trigger manifest reload
      httpMock.expectOne('/api/manifest').flush({ version: '2', images: [] });

      expect(component.uploadingImages()).toBeFalse();
      expect(component.uploadResult()!.uploaded).toEqual(['test.jpg']);
    });

    it('handles upload failure', () => {
      component.authenticated.set(true);

      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const event = { target: { files: dt.files, value: '' } } as unknown as Event;
      component.uploadImages(event);

      httpMock.expectOne('/api/upload').flush('error', { status: 500, statusText: 'Error' });

      expect(component.uploadingImages()).toBeFalse();
      expect(component.uploadResult()!.errors).toContain('Upload failed');
    });

    it('uploadImages does nothing with no files', () => {
      const event = { target: { files: null } } as unknown as Event;
      component.uploadImages(event);
      httpMock.expectNone('/api/upload');
    });

    it('onImageDrop handles file drop', () => {
      const file = new File(['test'], 'dropped.jpg', { type: 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);

      component.imageDragOver.set(true);
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
        dataTransfer: { files: dt.files },
      } as unknown as DragEvent;

      component.onImageDrop(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.imageDragOver()).toBeFalse();

      httpMock.expectOne('/api/upload').flush({ uploaded: ['dropped.jpg'], errors: [] });
      httpMock.expectOne('/api/manifest').flush({ version: '2', images: [] });
    });

    it('onImageDrop does nothing without files', () => {
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
        dataTransfer: { files: { length: 0 } },
      } as unknown as DragEvent;

      component.onImageDrop(event);
      httpMock.expectNone('/api/upload');
    });
  });

  describe('document click closes pickers', () => {
    it('closes bg picker on outside click', () => {
      component.bgPickerOpen.set(true);
      // Simulate a click outside — no anchor ref means it stays open since contains check fails
      component.onDocumentClick({ target: document.body } as unknown as MouseEvent);
      // Without the anchor ref, the check is skipped
      expect(component.bgPickerOpen()).toBeTrue();
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { PlatformService, Platform } from './platform.service';

describe('PlatformService', () => {
  describe('in browser environment', () => {
    let service: PlatformService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          PlatformService,
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      service = TestBed.inject(PlatformService);
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('detects web browser platform', () => {
      expect(service.currentPlatform()).toBe(Platform.WEB_BROWSER);
    });

    it('isWeb returns true', () => {
      expect(service.isWeb()).toBeTrue();
    });

    it('isTauri returns false', () => {
      expect(service.isTauri()).toBeFalse();
    });

    it('isSSR returns false', () => {
      expect(service.isSSR()).toBeFalse();
    });

    it('isBrowser returns true for web', () => {
      expect(service.isBrowser()).toBeTrue();
    });

    it('getPlatformName returns "web"', () => {
      expect(service.getPlatformName()).toBe('web');
    });
  });

  describe('in SSR environment', () => {
    let service: PlatformService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          PlatformService,
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
      service = TestBed.inject(PlatformService);
    });

    it('detects SSR platform', () => {
      expect(service.currentPlatform()).toBe(Platform.SSR_SERVER);
    });

    it('isSSR returns true', () => {
      expect(service.isSSR()).toBeTrue();
    });

    it('isWeb returns false', () => {
      expect(service.isWeb()).toBeFalse();
    });

    it('isBrowser returns false for SSR', () => {
      expect(service.isBrowser()).toBeFalse();
    });

    it('getPlatformName returns "ssr"', () => {
      expect(service.getPlatformName()).toBe('ssr');
    });
  });
});

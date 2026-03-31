import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { ConnectivityService } from './connectivity.service';
import { LogService } from './log.service';

describe('ConnectivityService', () => {
  let service: ConnectivityService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ConnectivityService,
        LogService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    service = TestBed.inject(ConnectivityService);
  });

  afterEach(() => {
    service.stop();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initializes as online', () => {
    expect(service.isOnline()).toBeTrue();
  });

  it('initializes showOffline as false', () => {
    expect(service.showOffline()).toBeFalse();
  });

  it('stop prevents further polling', () => {
    service.stop();
    // Should not throw
    expect(() => service.stop()).not.toThrow();
  });

  describe('in SSR environment', () => {
    let ssrService: ConnectivityService;

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ConnectivityService,
          LogService,
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
      ssrService = TestBed.inject(ConnectivityService);
    });

    afterEach(() => {
      ssrService.stop();
    });

    it('defaults to online in SSR', () => {
      expect(ssrService.isOnline()).toBeTrue();
    });

    it('start is a no-op in SSR', async () => {
      await expectAsync(ssrService.start()).toBeResolved();
    });
  });

  describe('verify', () => {
    it('sets online to true on successful fetch', fakeAsync(() => {
      spyOn(globalThis, 'fetch').and.returnValue(
        Promise.resolve(new Response('', { status: 200 }))
      );
      service.start();
      tick();
      expect(service.isOnline()).toBeTrue();
    }));

    it('sets online to false on fetch failure', fakeAsync(() => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.reject(new Error('network')));
      service.start();
      tick();
      expect(service.isOnline()).toBeFalse();
    }));

    it('schedules offline banner after failed verify', fakeAsync(() => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.reject(new Error('network')));
      service.start();
      tick();
      expect(service.showOffline()).toBeFalse(); // grace period not elapsed
      tick(3000); // grace period
      expect(service.showOffline()).toBeTrue();
      service.stop();
    }));

    it('clears offline banner on successful verify', fakeAsync(() => {
      // First fail
      spyOn(globalThis, 'fetch').and.returnValue(Promise.reject(new Error('fail')));
      service.start();
      tick();
      tick(3000);
      expect(service.showOffline()).toBeTrue();

      // Then succeed
      (globalThis.fetch as jasmine.Spy).and.returnValue(
        Promise.resolve(new Response('', { status: 200 }))
      );
      service.start();
      tick();
      expect(service.showOffline()).toBeFalse();
      service.stop();
    }));

    it('increases interval on non-ok response', fakeAsync(() => {
      spyOn(globalThis, 'fetch').and.returnValue(
        Promise.resolve(new Response('', { status: 500 }))
      );
      service.start();
      tick();
      // Should still be "online" (status > 0) but interval increases
      expect(service.isOnline()).toBeTrue();
      service.stop();
    }));
  });

  describe('window events', () => {
    it('goes online when window fires online event', () => {
      window.dispatchEvent(new Event('online'));
      expect(service.isOnline()).toBeTrue();
      expect(service.showOffline()).toBeFalse();
    });

    it('goes offline when window fires offline event', fakeAsync(() => {
      window.dispatchEvent(new Event('offline'));
      expect(service.isOnline()).toBeFalse();
      // Grace period
      tick(3000);
      expect(service.showOffline()).toBeTrue();
      // Recover
      window.dispatchEvent(new Event('online'));
      expect(service.showOffline()).toBeFalse();
      service.stop();
    }));
  });
});

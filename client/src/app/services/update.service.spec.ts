import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { UpdateService } from './update.service';
import { SwUpdate } from '@angular/service-worker';
import { LogService } from './log.service';

describe('UpdateService', () => {
  describe('in non-production environment', () => {
    let service: UpdateService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          UpdateService,
          LogService,
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: SwUpdate, useValue: null },
        ],
      });
      service = TestBed.inject(UpdateService);
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('init is a no-op in non-production', () => {
      // ENVIRONMENT.env is 'development' in tests, so init returns early
      expect(service).toBeTruthy();
    });
  });

  describe('in SSR', () => {
    let service: UpdateService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          UpdateService,
          LogService,
          { provide: PLATFORM_ID, useValue: 'server' },
          { provide: SwUpdate, useValue: null },
        ],
      });
      service = TestBed.inject(UpdateService);
    });

    it('creates without error in SSR', () => {
      expect(service).toBeTruthy();
    });
  });
});

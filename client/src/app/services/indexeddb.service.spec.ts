import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { IndexedDbService } from './indexeddb.service';

describe('IndexedDbService', () => {
  describe('in browser', () => {
    let service: IndexedDbService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          IndexedDbService,
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      service = TestBed.inject(IndexedDbService);
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('init opens the database', async () => {
      await service.init();
      // Calling init again is a no-op (already initialized)
      await service.init();
      expect().nothing();
    });

    it('set and get round-trips a value', async () => {
      await service.init();
      await service.set('test-key', { hello: 'world' });
      const val = await service.get<{ hello: string }>('test-key');
      expect(val).toEqual({ hello: 'world' });
    });

    it('get returns undefined for missing key', async () => {
      await service.init();
      const val = await service.get('nonexistent');
      expect(val).toBeUndefined();
    });

    it('delete removes a key', async () => {
      await service.init();
      await service.set('del-key', 'value');
      await service.delete('del-key');
      const val = await service.get('del-key');
      expect(val).toBeUndefined();
    });

    it('get auto-initializes if not yet init', async () => {
      // Don't call init() explicitly
      await service.set('auto-key', 42);
      const val = await service.get<number>('auto-key');
      expect(val).toBe(42);
    });

    it('set overwrites existing values', async () => {
      await service.init();
      await service.set('overwrite', 'first');
      await service.set('overwrite', 'second');
      const val = await service.get<string>('overwrite');
      expect(val).toBe('second');
    });

    it('handles various value types', async () => {
      await service.init();
      await service.set('num', 123);
      await service.set('bool', true);
      await service.set('arr', [1, 2, 3]);
      expect(await service.get<number>('num')).toBe(123);
      expect(await service.get<boolean>('bool')).toBe(true);
      expect(await service.get<number[]>('arr')).toEqual([1, 2, 3]);
    });
  });

  describe('in SSR', () => {
    let service: IndexedDbService;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          IndexedDbService,
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
      service = TestBed.inject(IndexedDbService);
    });

    it('init is a no-op in SSR', async () => {
      await service.init();
      expect().nothing();
    });

    it('get returns undefined in SSR', async () => {
      const val = await service.get('key');
      expect(val).toBeUndefined();
    });

    it('set is a no-op in SSR', async () => {
      await service.set('key', 'val');
      expect().nothing();
    });

    it('delete is a no-op in SSR', async () => {
      await service.delete('key');
      expect().nothing();
    });
  });
});

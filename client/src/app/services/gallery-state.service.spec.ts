import { TestBed } from '@angular/core/testing';
import { GalleryStateService, FloatingImage, ImageEntry } from './gallery-state.service';

describe('GalleryStateService', () => {
  let service: GalleryStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GalleryStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initializes with null cards and entries', () => {
    expect(service.cards).toBeNull();
    expect(service.entries).toBeNull();
  });

  it('initializes offset to 0', () => {
    expect(service.offset).toBe(0);
  });

  it('initializes manifestVersion to empty string', () => {
    expect(service.manifestVersion).toBe('');
  });

  it('persists cards when set', () => {
    const entry: ImageEntry = {
      id: 'test', filename: 'test.jpg', type: 'image/jpeg',
      thumb: '/t.jpg', full: '/f.jpg', tags: [], width: 100, height: 100,
      nsfw: false, copyright: '', bannerHeight: 0, captureDate: '', title: '', description: '',
    };
    const card: FloatingImage = {
      uid: 1, entry, x: 10, y: 20, w: 100, h: 100,
      rotation: 5, z: 0.5, zIndex: 50, shadow: '0 0 0',
    };
    service.cards = [card];
    expect(service.cards).toHaveSize(1);
    expect(service.cards![0].entry.id).toBe('test');
  });

  it('persists offset when set', () => {
    service.offset = 500;
    expect(service.offset).toBe(500);
  });

  it('persists manifestVersion when set', () => {
    service.manifestVersion = 'v2';
    expect(service.manifestVersion).toBe('v2');
  });
});

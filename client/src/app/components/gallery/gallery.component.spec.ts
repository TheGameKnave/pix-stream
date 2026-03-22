import { laneCount, buildShadow, makeCard } from './gallery.component';
import { ImageEntry } from '@app/services/gallery-state.service';

describe('laneCount', () => {
  it('returns 5 for wide/landscape viewports (ratio > 1.3)', () => {
    expect(laneCount(1920, 1080)).toBe(5);
    expect(laneCount(2560, 1440)).toBe(5);
  });

  it('returns 7 for roughly square viewports (0.8 < ratio <= 1.3)', () => {
    expect(laneCount(1024, 1024)).toBe(7);
    expect(laneCount(1200, 1000)).toBe(7);
  });

  it('returns 9 for tall/portrait viewports (ratio <= 0.8)', () => {
    expect(laneCount(768, 1024)).toBe(9);
    expect(laneCount(400, 800)).toBe(9);
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

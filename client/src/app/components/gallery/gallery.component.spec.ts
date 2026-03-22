import { laneCount, buildShadow, makeCard, visibleColRange, nearbyIds } from './gallery.component';
import { ImageEntry, FloatingImage } from '@app/services/gallery-state.service';

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
      entry: { id, filename: '', type: '', thumb: '', full: '', tags: [], width: 100, height: 100, nsfw: false, copyright: '' },
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

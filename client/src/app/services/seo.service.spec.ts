import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { SeoService } from './seo.service';

describe('SeoService', () => {
  let service: SeoService;
  let meta: Meta;
  let title: Title;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SeoService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: Router, useValue: { url: '/test' } },
      ],
    });
    service = TestBed.inject(SeoService);
    meta = TestBed.inject(Meta);
    title = TestBed.inject(Title);
  });

  describe('updateTags', () => {
    it('sets the page title and og:title', () => {
      service.updateTags({ title: 'My Photo' });
      expect(title.getTitle()).toBe('My Photo');
      const ogTitle = meta.getTag('property="og:title"');
      expect(ogTitle?.content).toBe('My Photo');
    });

    it('sets description and og:description', () => {
      service.updateTags({ description: 'A cool gallery' });
      const desc = meta.getTag('name="description"');
      expect(desc?.content).toBe('A cool gallery');
      const ogDesc = meta.getTag('property="og:description"');
      expect(ogDesc?.content).toBe('A cool gallery');
    });

    it('sets og:image when image is provided', () => {
      service.updateTags({ image: '/img/photo.jpg' });
      const ogImage = meta.getTag('property="og:image"');
      expect(ogImage?.content).toBe('/img/photo.jpg');
    });

    it('sets og:url from config or falls back to current location', () => {
      service.updateTags({ url: 'https://example.com/photo/1' });
      const ogUrl = meta.getTag('property="og:url"');
      expect(ogUrl?.content).toBe('https://example.com/photo/1');
    });

    it('sets og:type when provided', () => {
      service.updateTags({ type: 'article' });
      const ogType = meta.getTag('property="og:type"');
      expect(ogType?.content).toBe('article');
    });

    it('does not set title tags when title is not provided', () => {
      const origTitle = title.getTitle();
      service.updateTags({ description: 'desc only' });
      // Title should remain unchanged
      expect(title.getTitle()).toBe(origTitle);
    });
  });

  describe('setKeywords', () => {
    it('sets keywords meta tag with comma-separated values', () => {
      service.setKeywords(['nature', 'portrait', 'bw']);
      const kw = meta.getTag('name="keywords"');
      expect(kw?.content).toBe('nature, portrait, bw');
    });

    it('handles empty array', () => {
      service.setKeywords([]);
      const kw = meta.getTag('name="keywords"');
      expect(kw?.content).toBe('');
    });

    it('handles single tag', () => {
      service.setKeywords(['landscape']);
      const kw = meta.getTag('name="keywords"');
      expect(kw?.content).toBe('landscape');
    });
  });

  describe('clearKeywords', () => {
    it('removes keywords meta tag', () => {
      service.setKeywords(['test']);
      expect(meta.getTag('name="keywords"')).toBeTruthy();
      service.clearKeywords();
      expect(meta.getTag('name="keywords"')).toBeNull();
    });
  });
});

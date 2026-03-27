import { Injectable } from '@angular/core';

export interface ImageEntry {
  id: string;
  filename: string;
  type: string;
  thumb: string;
  thumbBlur?: string;
  full: string;
  tags: string[];
  width: number;
  height: number;
  nsfw: boolean;
  copyright: string;
}

export interface ManifestResponse {
  version: string;
  images: ImageEntry[];
}

export interface FloatingImage {
  entry: ImageEntry;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  zIndex: number;
  shadow: string;
  exiting?: boolean;
}

/**
 * Persists gallery layout and river state across route changes
 * so navigating to lightbox and back doesn't reset the distribution.
 */
@Injectable({ providedIn: 'root' })
export class GalleryStateService {
  cards: FloatingImage[] | null = null;
  entries: ImageEntry[] | null = null;
  offset = 0;
  manifestVersion = '';
}

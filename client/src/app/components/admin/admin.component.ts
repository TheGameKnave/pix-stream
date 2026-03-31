import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewChild, AfterViewChecked, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { take } from 'rxjs';
import { SiteConfigService, SiteConfig } from '@app/services/site-config.service';
import { ScrollIndicatorDirective } from '@app/directives/scroll-indicator.directive';
import { MarkdownEditorComponent } from '@app/directives/markdown-editor.directive';
import { ManifestResponse } from '@app/services/gallery-state.service';

interface AuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
}

const FONT_OPTIONS = [
  'Raleway', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
  'Playfair Display', 'Merriweather', 'Poppins', 'Nunito', 'Source Sans 3',
  'Oswald', 'Josefin Sans', 'Cormorant Garamond', 'Libre Baskerville',
];


@Component({
  selector: 'app-admin',
  templateUrl: 'admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ScrollIndicatorDirective, MarkdownEditorComponent],
  host: { class: 'admin-host' },
})
export class AdminComponent implements AfterViewChecked {
  private readonly http = inject(HttpClient);
  readonly siteConfig = inject(SiteConfigService);

  @ViewChild('bgCanvas') bgCanvasRef?: ElementRef<HTMLCanvasElement>;

  readonly loading = signal(true);
  readonly authenticated = signal(false);
  readonly setupRequired = signal(false);
  readonly error = signal('');
  readonly showForgot = signal(false);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly saveStatus = signal('');

  readonly fontOptions = FONT_OPTIONS;
  readonly fontPickerOpen = signal(false);
  private fontPreviewsLoaded = false;

  // Accordion state
  readonly accordionIdentity = signal(true);   // auto-expand on load
  readonly accordionTheme = signal(false);
  readonly accordionTags = signal(false);
  readonly accordionFlow = signal(false);
  readonly accordionFeatures = signal(false);
  readonly bgPickerOpen = signal(false);
  @ViewChild('bgPickerAnchor') bgPickerAnchorRef?: ElementRef<HTMLElement>;
  bgDragging = false;
  private bgCanvasDrawn = false;
  bgLightness = 50;

  readonly hdrPickerOpen = signal(false);
  @ViewChild('hdrPickerAnchor') hdrPickerAnchorRef?: ElementRef<HTMLElement>;
  @ViewChild('hdrCanvas') hdrCanvasRef?: ElementRef<HTMLCanvasElement>;
  hdrDragging = false;
  private hdrCanvasDrawn = false;
  hdrLightness = 50;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.bgPickerOpen() && this.bgPickerAnchorRef &&
        !this.bgPickerAnchorRef.nativeElement.contains(event.target as Node)) {
      this.bgPickerOpen.set(false);
    }
    if (this.hdrPickerOpen() && this.hdrPickerAnchorRef &&
        !this.hdrPickerAnchorRef.nativeElement.contains(event.target as Node)) {
      this.hdrPickerOpen.set(false);
    }
  }

  password = '';
  confirmPassword = '';

  // Editable config fields
  title = '';
  subtitle = '';
  headerColor = '#01ddb1';
  bgColor = '#808080';
  fontBody = 'Raleway';
  customFontBody = '';
  nsfwBlurDefault = false;
  enabledTags: string[] = [];
  tagDisplayMode: 'nav' | 'dropdown' = 'nav';
  enableShare = true;
  enableDownload = true;
  enableQr = true;
  enableKiosk = true;
  flowDirection: 'rtl' | 'ltr' | 'ttb' | 'btt' = 'rtl';
  flowSpeed: 'off' | 'low' | 'med' | 'high' = 'med';
  contactEmail = '';
  pageHeadTitle = '';
  description = '';
  readonly siteLogo = signal('');
  readonly siteFavicon = signal('');
  readonly watermark = signal('');
  sortOrder: 'date-desc' | 'date-asc' | 'random' = 'random';

  // Hidden images report
  private allImages: { id: string; tags: string[]; thumb: string }[] = [];
  readonly hiddenCount = signal(0);
  readonly hiddenImages = signal<{ id: string; thumb: string }[]>([]);
  readonly totalImageCount = signal(0);
  readonly showHidden = signal(false);

  constructor() {
    this.checkStatus();
  }

  ngAfterViewChecked(): void {
    if (this.bgCanvasRef && !this.bgCanvasDrawn) {
      this.bgCanvasDrawn = true;
      this.drawCanvas(this.bgCanvasRef.nativeElement, this.bgColor, this.bgLightness);
    }
    if (this.hdrCanvasRef && !this.hdrCanvasDrawn) {
      this.hdrCanvasDrawn = true;
      this.drawCanvas(this.hdrCanvasRef.nativeElement, this.headerColor, this.hdrLightness);
    }
    if (!this.bgCanvasRef) this.bgCanvasDrawn = false;
    if (!this.hdrCanvasRef) this.hdrCanvasDrawn = false;
  }

  private checkStatus(): void {
    this.http.get<AuthStatus>('/api/auth/status').pipe(take(1)).subscribe({
      next: (res) => {
        this.authenticated.set(res.authenticated);
        this.setupRequired.set(res.setupRequired);
        this.loading.set(false);
        if (res.authenticated) {
          this.loadConfig();
          this.loadManifest();
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private loadConfig(): void {
    const config = this.siteConfig.config();
    if (config) this.populateFields(config);
  }

  private loadManifest(): void {
    this.http.get<ManifestResponse>('/api/manifest').pipe(take(1)).subscribe({
      next: (res) => {
        this.allImages = res.images.map(i => ({ id: i.id, tags: i.tags, thumb: i.thumb }));
        this.totalImageCount.set(this.allImages.length);
        this.recalcHidden();
      },
    });
  }

  private populateFields(c: SiteConfig): void {
    this.title = c.title;
    this.subtitle = c.subtitle;
    this.headerColor = c.headerColor;
    const [, , hdrL] = this.hexToHsl(c.headerColor);
    this.hdrLightness = Math.round(Math.max(20, Math.min(80, hdrL)));
    this.bgColor = c.bgColor;
    const [, , bgL] = this.hexToHsl(c.bgColor);
    this.bgLightness = Math.round(Math.max(20, Math.min(80, bgL)));
    this.nsfwBlurDefault = c.nsfwBlurDefault;
    this.enabledTags = [...(c.enabledTags ?? [])];
    this.tagDisplayMode = c.tagDisplayMode ?? 'nav';
    this.enableShare = c.enableShare ?? true;
    this.enableDownload = c.enableDownload ?? true;
    this.enableQr = c.enableQr ?? true;
    this.enableKiosk = c.enableKiosk ?? true;
    this.flowDirection = c.flowDirection ?? 'rtl';
    this.flowSpeed = c.flowSpeed ?? 'med';
    this.contactEmail = c.contactEmail ?? '';
    this.pageHeadTitle = c.pageHeadTitle ?? '';
    this.description = c.description ?? '';
    this.siteLogo.set(c.siteLogo ?? '');
    this.siteFavicon.set(c.siteFavicon ?? '');
    this.watermark.set(c.watermark ?? '');
    this.sortOrder = c.sortOrder ?? 'random';

    if (FONT_OPTIONS.includes(c.fontBody)) {
      this.fontBody = c.fontBody;
      this.customFontBody = '';
    } else {
      this.fontBody = '_custom';
      this.customFontBody = c.fontBody;
    }
  }

  get resolvedFontBody(): string {
    return this.fontBody === '_custom' ? this.customFontBody : this.fontBody;
  }

  toggleFontPicker(): void {
    this.fontPickerOpen.update(v => !v);
    if (!this.fontPreviewsLoaded) {
      this.fontPreviewsLoaded = true;
      const families = FONT_OPTIONS.filter(f => f !== 'Raleway')
        .map(f => `family=${encodeURIComponent(f)}:wght@400;700`)
        .join('&');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
      document.head.appendChild(link);
    }
  }

  selectFont(font: string): void {
    this.fontBody = font;
    this.customFontBody = '';
    this.fontPickerOpen.set(false);
    this.onConfigChange();
  }

  selectCustomFont(): void {
    this.fontBody = '_custom';
    this.fontPickerOpen.set(false);
  }

  // --- Shared hue/saturation picker ---

  private readonly GRAY_STRIP = 14;

  private drawCanvas(canvas: HTMLCanvasElement, colorHex: string, lightness: number): void {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const gradientH = canvas.height - this.GRAY_STRIP;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < gradientH; y++) {
        const hue = (x / w) * 360;
        const sat = 100 - (y / gradientH) * 100;
        ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lightness}%)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = `hsl(0, 0%, ${lightness}%)`;
    ctx.fillRect(0, gradientH, w, this.GRAY_STRIP);
    ctx.strokeStyle = 'rgba(128,128,128,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gradientH);
    ctx.lineTo(w, gradientH);
    ctx.stroke();
    // Crosshair
    const [hue, sat] = this.hexToHsl(colorHex);
    const cx = (hue / 360) * w;
    const cy = sat === 0 ? gradientH + this.GRAY_STRIP / 2 : ((100 - sat) / 100) * gradientH;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  private pickFromCanvas(canvas: HTMLCanvasElement, event: MouseEvent | Touch, lightness: number): { hue: number; sat: number; hex: string } {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const gradientH = rect.height * (canvas.height - this.GRAY_STRIP) / canvas.height;
    const hue = (x / rect.width) * 360;
    const sat = y >= gradientH ? 0 : 100 - (y / gradientH) * 100;
    return { hue, sat, hex: this.hslToHex(hue, sat, lightness) };
  }

  private hexToHsl(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  private hslToHex(h: number, s: number, l: number): string {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  // --- Background picker events ---

  private pickBg(event: MouseEvent | Touch): void {
    const canvas = this.bgCanvasRef?.nativeElement;
    if (!canvas) return;
    const result = this.pickFromCanvas(canvas, event, this.bgLightness);
    this.bgColor = result.hex;
    this.bgCanvasDrawn = false;
    this.onConfigChange();
  }

  onBgCanvasMouseDown(event: MouseEvent): void { this.bgDragging = true; this.pickBg(event); }
  onBgCanvasDrag(event: MouseEvent): void { if (this.bgDragging) this.pickBg(event); }
  onBgCanvasTouchStart(event: TouchEvent): void { event.preventDefault(); this.bgDragging = true; this.pickBg(event.touches[0]); }
  onBgCanvasTouchMove(event: TouchEvent): void { event.preventDefault(); if (this.bgDragging) this.pickBg(event.touches[0]); }

  onBgLightnessChange(): void {
    const [hue, sat] = this.hexToHsl(this.bgColor);
    this.bgColor = this.hslToHex(hue, sat, this.bgLightness);
    this.bgCanvasDrawn = false;
    this.onConfigChange();
  }

  onBgColorInputChange(): void {
    const [, , l] = this.hexToHsl(this.bgColor);
    this.bgLightness = Math.round(Math.max(20, Math.min(80, l)));
    this.bgCanvasDrawn = false;
    this.onConfigChange();
  }

  // --- Header color picker events ---

  private pickHdr(event: MouseEvent | Touch): void {
    const canvas = this.hdrCanvasRef?.nativeElement;
    if (!canvas) return;
    const result = this.pickFromCanvas(canvas, event, this.hdrLightness);
    this.headerColor = result.hex;
    this.hdrCanvasDrawn = false;
    this.onConfigChange();
  }

  onHdrCanvasMouseDown(event: MouseEvent): void { this.hdrDragging = true; this.pickHdr(event); }
  onHdrCanvasDrag(event: MouseEvent): void { if (this.hdrDragging) this.pickHdr(event); }
  onHdrCanvasTouchStart(event: TouchEvent): void { event.preventDefault(); this.hdrDragging = true; this.pickHdr(event.touches[0]); }
  onHdrCanvasTouchMove(event: TouchEvent): void { event.preventDefault(); if (this.hdrDragging) this.pickHdr(event.touches[0]); }

  onHdrLightnessChange(): void {
    const [hue, sat] = this.hexToHsl(this.headerColor);
    this.headerColor = this.hslToHex(hue, sat, this.hdrLightness);
    this.hdrCanvasDrawn = false;
    this.onConfigChange();
  }

  onHdrColorInputChange(): void {
    const [, , l] = this.hexToHsl(this.headerColor);
    this.hdrLightness = Math.round(Math.max(20, Math.min(80, l)));
    this.hdrCanvasDrawn = false;
    this.onConfigChange();
  }

  // --- Logo upload/remove ---

  uploadLogo(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    this.http.post<{ url: string }>('/api/logo', fd).pipe(take(1)).subscribe({
      next: (res) => {
        this.siteLogo.set(res.url + '?t=' + Date.now());
        this.onConfigChange();
      },
      error: (err: unknown) => this.error.set((err as { error?: { error?: string } }).error?.error || 'Logo upload failed'),
    });
    input.value = '';
  }

  removeLogo(): void {
    this.siteLogo.set('');
    this.onConfigChange();
    this.http.delete('/api/logo', { responseType: 'text' }).pipe(take(1)).subscribe();
  }

  // --- Favicon upload/remove ---

  uploadFavicon(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('favicon', file);
    this.http.post<{ url: string }>('/api/favicon', fd).pipe(take(1)).subscribe({
      next: (res) => {
        this.siteFavicon.set(res.url + '?t=' + Date.now());
        this.onConfigChange();
      },
      error: (err: unknown) => this.error.set((err as { error?: { error?: string } }).error?.error || 'Favicon upload failed'),
    });
    input.value = '';
  }

  removeFavicon(): void {
    this.siteFavicon.set('');
    this.onConfigChange();
    this.http.delete('/api/favicon', { responseType: 'text' }).pipe(take(1)).subscribe();
  }

  // --- Watermark upload/remove ---

  uploadWatermark(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('watermark', file);
    this.http.post<{ url: string }>('/api/watermark', fd).pipe(take(1)).subscribe({
      next: (res) => {
        this.watermark.set(res.url + '?t=' + Date.now());
        this.onConfigChange();
      },
      error: (err: unknown) => this.error.set((err as { error?: { error?: string } }).error?.error || 'Watermark upload failed'),
    });
    input.value = '';
  }

  removeWatermark(): void {
    this.watermark.set('');
    this.onConfigChange();
    this.http.delete('/api/watermark', { responseType: 'text' }).pipe(take(1)).subscribe();
  }

  // --- Image upload ---

  readonly uploadingImages = signal(false);
  readonly uploadResult = signal<{ uploaded: string[]; errors: string[] } | null>(null);

  uploadImages(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.sendImageFiles(input.files);
    input.value = '';
  }

  onImageDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.imageDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) this.sendImageFiles(files);
  }

  readonly imageDragOver = signal(false);

  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    this.imageDragOver.set(true);
  }

  onImageDragLeave(): void {
    this.imageDragOver.set(false);
  }

  private sendImageFiles(files: FileList): void {
    this.uploadingImages.set(true);
    this.uploadResult.set(null);
    const fd = new FormData();
    for (const file of Array.from(files)) {
      fd.append('images[]', file);
    }
    this.http.post<{ uploaded: string[]; errors: string[] }>('/api/upload', fd).pipe(take(1)).subscribe({
      next: (res) => {
        this.uploadResult.set(res);
        this.uploadingImages.set(false);
        if (res.uploaded.length > 0) {
          this.loadManifest();
        }
      },
      error: () => {
        this.uploadResult.set({ uploaded: [], errors: ['Upload failed'] });
        this.uploadingImages.set(false);
      },
    });
  }

  selectAllTags(): void {
    this.enabledTags = [...this.siteConfig.allTags()];
    this.recalcHidden();
    this.onConfigChange();
  }

  deselectAllTags(): void {
    this.enabledTags = [];
    this.recalcHidden();
    this.onConfigChange();
  }

  toggleTag(tag: string): void {
    const idx = this.enabledTags.indexOf(tag);
    if (idx >= 0) {
      this.enabledTags.splice(idx, 1);
    } else {
      this.enabledTags.push(tag);
    }
    this.recalcHidden();
    this.onConfigChange();
  }

  isTagEnabled(tag: string): boolean {
    return this.enabledTags.length === 0 || this.enabledTags.includes(tag);
  }

  private recalcHidden(): void {
    if (this.enabledTags.length === 0) {
      this.hiddenCount.set(0);
      this.hiddenImages.set([]);
      return;
    }
    const hidden = this.allImages.filter(img =>
      !img.tags.some(t => this.enabledTags.includes(t))
    );
    this.hiddenCount.set(hidden.length);
    this.hiddenImages.set(hidden.map(i => ({ id: i.id, thumb: i.thumb })));
  }

  onConfigChange(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 600);
  }

  private flush(): void {
    this.saveStatus.set('Saving...');
    this.siteConfig.saveConfig({
      title: this.title,
      subtitle: this.subtitle,
      headerColor: this.headerColor,
      bgColor: this.bgColor,
      fontBody: this.resolvedFontBody,
      nsfwBlurDefault: this.nsfwBlurDefault,
      enabledTags: this.enabledTags,
      tagDisplayMode: this.tagDisplayMode,
      enableShare: this.enableShare,
      enableDownload: this.enableDownload,
      enableQr: this.enableQr,
      enableKiosk: this.enableKiosk,
      flowDirection: this.flowDirection,
      flowSpeed: this.flowSpeed,
      contactEmail: this.contactEmail,
      pageHeadTitle: this.pageHeadTitle,
      description: this.description,
      siteLogo: this.siteLogo(),
      siteFavicon: this.siteFavicon(),
      watermark: this.watermark(),
      sortOrder: this.sortOrder,
    });
    // Announce save completion (service is fire-and-forget)
    setTimeout(() => this.saveStatus.set('Saved'), 500);
    setTimeout(() => this.saveStatus.set(''), 2500);
  }

  setup(): void {
    this.error.set('');
    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match');
      return;
    }
    this.http.post<{ success?: boolean; error?: string }>('/api/auth/setup', { password: this.password }).pipe(take(1)).subscribe({
      next: (res) => {
        if (res.success) {
          this.authenticated.set(true);
          this.setupRequired.set(false);
          this.siteConfig.adminSetupRequired.set(false);
          this.siteConfig.adminAuthenticated.set(true);
          this.password = '';
          this.confirmPassword = '';
          this.loadConfig();
          this.loadManifest();
        }
      },
      error: (err: unknown) => this.error.set((err as { error?: { error?: string } }).error?.error || 'Setup failed'),
    });
  }

  login(): void {
    this.error.set('');
    this.http.post<{ success?: boolean; error?: string }>('/api/auth/login', { password: this.password }).pipe(take(1)).subscribe({
      next: (res) => {
        if (res.success) {
          this.authenticated.set(true);
          this.siteConfig.adminAuthenticated.set(true);
          this.password = '';
          this.loadConfig();
          this.loadManifest();
        }
      },
      error: (err: unknown) => this.error.set((err as { error?: { error?: string } }).error?.error || 'Login failed'),
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (this.setupRequired()) {
        this.setup();
      } else {
        this.login();
      }
    }
  }
}

import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LogService } from './log.service';

const BASE_INTERVAL_MS = 10_000;
const MAX_INTERVAL_MS = 60_000;
const GRACE_PERIOD_MS = 3_000;

@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly logService = inject(LogService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly _isOnline = signal<boolean>(this.isBrowser ? navigator.onLine : true);
  isOnline = this._isOnline.asReadonly();

  private readonly _showOffline = signal<boolean>(false);
  showOffline = this._showOffline.asReadonly();

  private stopped = false;
  private currentInterval = BASE_INTERVAL_MS;
  private pollingTimer?: ReturnType<typeof setTimeout>;
  private offlineTimer?: ReturnType<typeof setTimeout>;
  private pingUrl = '';

  constructor() {
    if (!this.isBrowser) return;
    this.pingUrl = globalThis.location.origin + '/favicon.ico';

    window.addEventListener('online', () => {
      this._isOnline.set(true);
      this.clearOfflineBanner();
    });
    window.addEventListener('offline', () => {
      this._isOnline.set(false);
      this.scheduleOfflineBanner();
    });

    this.scheduleNextCheck();
  }

  async start(): Promise<void> {
    if (!this.isBrowser) return;
    await this.verify();
  }

  stop() {
    this.stopped = true;
    if (this.pollingTimer) clearTimeout(this.pollingTimer);
    if (this.offlineTimer) clearTimeout(this.offlineTimer);
  }

  private scheduleNextCheck() {
    if (this.stopped) return;
    this.pollingTimer = setTimeout(async () => {
      await this.verify();
      this.scheduleNextCheck();
    }, this.currentInterval);
  }

  private async verify() {
    try {
      const res = await fetch(`${this.pingUrl}?ts=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'ngsw-bypass': 'true' },
      });
      this._isOnline.set(res.status > 0);
      if (res.ok) {
        this.currentInterval = BASE_INTERVAL_MS;
        this.clearOfflineBanner();
      } else {
        this.currentInterval = Math.min(this.currentInterval * 2, MAX_INTERVAL_MS);
        this.scheduleOfflineBanner();
      }
    } catch {
      if (!this.stopped) {
        this._isOnline.set(false);
        this.currentInterval = Math.min(this.currentInterval * 2, MAX_INTERVAL_MS);
        this.scheduleOfflineBanner();
      }
    }
  }

  private scheduleOfflineBanner() {
    if (!this.offlineTimer) {
      this.offlineTimer = setTimeout(() => {
        this._showOffline.set(true);
        this.offlineTimer = undefined;
      }, GRACE_PERIOD_MS);
    }
  }

  private clearOfflineBanner() {
    if (this.offlineTimer) {
      clearTimeout(this.offlineTimer);
      this.offlineTimer = undefined;
    }
    this._showOffline.set(false);
  }
}

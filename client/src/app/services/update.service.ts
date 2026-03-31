import { DestroyRef, Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwUpdate } from '@angular/service-worker';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, startWith } from 'rxjs';

import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from '@tauri-apps/api/core';

import { ENVIRONMENT } from 'src/environments/environment';
import { LogService } from './log.service';

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly logService = inject(LogService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private confirming = false;

  constructor() {
    this.init();
  }

  protected init(): void {
    if (!this.isBrowser) return;
    if (ENVIRONMENT.env !== 'production') return;

    if (this.updates) {
      this.updates.versionUpdates
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(event => {
          if (event.type === 'VERSION_READY') {
            this.logService.log('SW: New version ready');
            this.updates!.activateUpdate().then(() => {
              if (confirm('A new version is available. Reload now?')) {
                globalThis.location.reload();
              }
            });
          }
        });
    }

    interval(CHECK_INTERVAL_MS)
      .pipe(startWith(0), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!isTauri() && this.updates?.isEnabled) {
          this.updates.checkForUpdate().catch(err =>
            console.error('SW: checkForUpdate failed:', err)
          );
        }
        this.checkTauriUpdate();
      });
  }

  private async checkTauriUpdate(): Promise<void> {
    if (!isTauri()) return;
    try {
      const update = await check();
      if (update && !this.confirming) {
        this.confirming = true;
        const confirmed = await ask('A new version is available. Install and restart now?', {
          title: 'Update Available',
          okLabel: 'Yes',
          cancelLabel: 'Later',
        });
        if (confirmed) {
          await update.downloadAndInstall(() => { /* noop */ });
          await relaunch();
        }
        this.confirming = false;
      }
    } catch (err) {
      console.error('Tauri updater failed:', err);
    }
  }
}

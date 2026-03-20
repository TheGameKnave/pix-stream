import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'photo-stream';
const DB_VERSION = 1;
const STORE_NAME = 'preferences';

@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private db: IDBPDatabase | null = null;

  async init(): Promise<void> {
    if (!this.isBrowser || this.db) return;
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.db) await this.init();
    if (!this.db) return undefined;
    return this.db.get(STORE_NAME, key);
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) return;
    await this.db.put(STORE_NAME, value, key);
  }

  async delete(key: string): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) return;
    await this.db.delete(STORE_NAME, key);
  }
}

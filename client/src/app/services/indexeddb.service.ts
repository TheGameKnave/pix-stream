import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'pix-stream';
const DB_VERSION = 2;
const STORE_PREFERENCES = 'preferences';
const STORE_CACHE = 'cache';

@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private db: IDBPDatabase | null = null;

  async init(): Promise<void> {
    if (!this.isBrowser || this.db) return;
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(STORE_PREFERENCES)) {
          db.createObjectStore(STORE_PREFERENCES);
        }
        if (oldVersion < 2 && !db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE);
        }
      },
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.db) await this.init();
    if (!this.db) return undefined;
    return this.db.get(STORE_PREFERENCES, key);
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) return;
    await this.db.put(STORE_PREFERENCES, value, key);
  }

  async delete(key: string): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) return;
    await this.db.delete(STORE_PREFERENCES, key);
  }

  async getCache<T>(key: string): Promise<T | undefined> {
    if (!this.db) await this.init();
    if (!this.db) return undefined;
    return this.db.get(STORE_CACHE, key);
  }

  async setCache(key: string, value: unknown): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) return;
    await this.db.put(STORE_CACHE, value, key);
  }
}

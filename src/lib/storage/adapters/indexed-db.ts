/**
 * IndexedDB 存储适配器
 * 提供基于 IndexedDB 的数据存储实现
 */
import { BaseStorageAdapter } from './base-adapter.js';
import { StorageKey, StorageAdapter } from '../storage-types.js';
import { Logger } from '../../logger/logger.js';

interface IndexedDBOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
}

export class IndexedDBAdapter extends BaseStorageAdapter implements StorageAdapter {
  private dbName: string;
  private storeName: string;
  private version: number;
  private db: IDBDatabase | null = null;
  private dbReadyPromise: Promise<IDBDatabase> | null = null;

  /**
   * 构造函数
   * @param options 配置选项
   */
  constructor(options: IndexedDBOptions = {}) {
    super('IndexedDBAdapter');
    this.dbName = options.dbName || 'chrome-extension-storage';
    this.storeName = options.storeName || 'keyvalue-store';
    this.version = options.version || 1;
  }

  /**
   * 检查IndexedDB是否可用
   */
  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        // 检查IndexedDB是否存在
        if (!window.indexedDB) {
          this.logger.warn('IndexedDB在当前环境不可用');
          resolve(false);
          return;
        }
        
        // 尝试打开数据库以验证可用性
        const request = indexedDB.open('availability-test');
        
        request.onerror = () => {
          this.logger.warn('IndexedDB打开失败，可能被禁用或不支持');
          resolve(false);
        };
        
        request.onsuccess = (event) => {
          const db = request.result;
          db.close();
          // 如果能打开，则尝试删除测试数据库
          indexedDB.deleteDatabase('availability-test');
          resolve(true);
        };
      } catch (error) {
        this.logger.error('检查IndexedDB可用性时出错', error);
        resolve(false);
      }
    });
  }

  /**
   * 获取数据库连接
   */
  private async getDatabase(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.dbReadyPromise) {
      return this.dbReadyPromise;
    }

    this.dbReadyPromise = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const request = indexedDB.open(this.dbName, this.version);

        request.onerror = (event) => {
          this.logger.error('打开IndexedDB失败', (event.target as any).error);
          reject(new Error('无法打开IndexedDB数据库'));
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          // 创建对象存储，如果不存在
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
            this.logger.info(`创建对象存储: ${this.storeName}`);
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.logger.debug(`IndexedDB已打开: ${this.dbName}`);
          resolve(this.db);
        };
      } catch (error) {
        this.logger.error('初始化IndexedDB时出错', error);
        reject(error);
      }
    });

    return this.dbReadyPromise;
  }

  /**
   * 创建事务和对象存储
   * @param mode 事务模式
   */
  private async getObjectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.getDatabase();
    const transaction = db.transaction(this.storeName, mode);
    return transaction.objectStore(this.storeName);
  }

  /**
   * 设置存储项
   * @param key 键
   * @param value 值
   */
  async set<T>(key: StorageKey, value: T): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const store = await this.getObjectStore('readwrite');
        const request = store.put(value, key);

        request.onsuccess = () => {
          this.logger.debug(`IndexedDB项已设置: ${key}`);
          resolve();
        };

        request.onerror = (event) => {
          this.logger.error(`设置IndexedDB项失败: ${key}`, (event.target as any).error);
          reject(new Error(`设置IndexedDB项失败: ${key}`));
        };
      } catch (error) {
        this.logger.error(`设置IndexedDB项失败: ${key}`, error);
        reject(error);
      }
    });
  }

  /**
   * 获取存储项
   * @param key 键
   */
  async get<T>(key: StorageKey): Promise<T | null> {
    return new Promise<T | null>(async (resolve, reject) => {
      try {
        const store = await this.getObjectStore('readonly');
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = (event) => {
          this.logger.error(`获取IndexedDB项失败: ${key}`, (event.target as any).error);
          reject(new Error(`获取IndexedDB项失败: ${key}`));
        };
      } catch (error) {
        this.logger.error(`获取IndexedDB项失败: ${key}`, error);
        reject(error);
      }
    });
  }

  /**
   * 删除存储项
   * @param key 键
   */
  async remove(key: StorageKey): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const store = await this.getObjectStore('readwrite');
        const request = store.delete(key);

        request.onsuccess = () => {
          this.logger.debug(`IndexedDB项已删除: ${key}`);
          resolve();
        };

        request.onerror = (event) => {
          this.logger.error(`删除IndexedDB项失败: ${key}`, (event.target as any).error);
          reject(new Error(`删除IndexedDB项失败: ${key}`));
        };
      } catch (error) {
        this.logger.error(`删除IndexedDB项失败: ${key}`, error);
        reject(error);
      }
    });
  }

  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const store = await this.getObjectStore('readwrite');
        const request = store.clear();

        request.onsuccess = () => {
          this.logger.debug('IndexedDB存储已清空');
          resolve();
        };

        request.onerror = (event) => {
          this.logger.error('清空IndexedDB存储失败', (event.target as any).error);
          reject(new Error('清空IndexedDB存储失败'));
        };
      } catch (error) {
        this.logger.error('清空IndexedDB存储失败', error);
        reject(error);
      }
    });
  }

  /**
   * 获取所有键
   */
  async keys(): Promise<StorageKey[]> {
    return new Promise<StorageKey[]>(async (resolve, reject) => {
      try {
        const store = await this.getObjectStore('readonly');
        const request = store.getAllKeys();

        request.onsuccess = () => {
          resolve(Array.from(request.result) as StorageKey[]);
        };

        request.onerror = (event) => {
          this.logger.error('获取IndexedDB键失败', (event.target as any).error);
          reject(new Error('获取IndexedDB键失败'));
        };
      } catch (error) {
        this.logger.error('获取IndexedDB键失败', error);
        reject(error);
      }
    });
  }

  /**
   * 检查键是否存在
   * @param key 键
   */
  async has(key: StorageKey): Promise<boolean> {
    return new Promise<boolean>(async (resolve, reject) => {
      try {
        const store = await this.getObjectStore('readonly');
        const request = store.count(key);

        request.onsuccess = () => {
          resolve(request.result > 0);
        };

        request.onerror = (event) => {
          this.logger.error(`检查IndexedDB键失败: ${key}`, (event.target as any).error);
          reject(new Error(`检查IndexedDB键失败: ${key}`));
        };
      } catch (error) {
        this.logger.error(`检查IndexedDB键失败: ${key}`, error);
        reject(error);
      }
    });
  }
}
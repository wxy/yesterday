import { BaseStorageAdapter } from './base-adapter.js';
import { StorageKey, StorageItemOptions } from '../storage-types.js';
import { _Error } from '../../i18n/i18n.js';

/**
 * Chrome存储类型
 */
export type ChromeStorageType = 'local' | 'sync' | 'session';

/**
 * Chrome存储适配器选项
 */
export interface ChromeStorageOptions {
  /** 存储类型 */
  type?: ChromeStorageType;
  /** 自动压缩大对象 (避免超出同步存储限制) */
  compressLargeObjects?: boolean;
  /** 压缩阀值 (字节) */
  compressionThreshold?: number;
}

/**
 * 判断当前环境是否为 Service Worker
 */
const isServiceWorker = typeof window === 'undefined' && typeof self !== 'undefined';

/**
 * 获取 chrome.storage.local 或 chrome.storage.sync，自动降级
 */
function getChromeStorageArea(type: 'local' | 'sync') {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    if (type === 'sync' && chrome.storage.sync) {
      return chrome.storage.sync;
    }
    // 默认或降级
    return chrome.storage.local;
  }
  throw new _Error('chrome_storage_unavailable', 'chrome.storage 不可用');
}

/**
 * Chrome存储适配器
 */
export class ChromeStorageAdapter extends BaseStorageAdapter {
  private storageType: ChromeStorageType;
  private storage: chrome.storage.StorageArea;
  private compressLargeObjects: boolean;
  private compressionThreshold: number;
  
  /**
   * 构造函数
   * @param options 选项
   */
  constructor(options: ChromeStorageOptions = {}) {
    super('ChromeStorage');
    
    this.storageType = options.type || 'local';
    this.compressLargeObjects = options.compressLargeObjects || false;
    this.compressionThreshold = options.compressionThreshold || 8192; // 8KB
    
    // 获取对应的存储区域
    if (this.storageType === 'session') {
      if (isServiceWorker) {
        throw new _Error('session_storage_unavailable_in_sw', 'session storage 在 Service Worker 环境中不可用');
      }
      this.storage = chrome.storage.session;
    } else {
      this.storage = getChromeStorageArea(this.storageType);
    }
  }
  
  /**
   * 检查存储是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      return !!chrome && !!chrome.storage && !!this.storage;
    } catch (e) {
      return false;
    }
  }
  
  /**
   * 设置存储项
   */
  async set<T>(key: StorageKey, data: T): Promise<void> {
    return new Promise((resolve, reject) => {
      // 将数据进行预处理（例如压缩大对象）
      const processedData = this.processDataForStorage(data);
      
      const item = { [key]: processedData };
      this.storage.set(item, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * 获取存储项
   */
  async get<T>(key: StorageKey): Promise<T | null> {
    return new Promise((resolve, reject) => {
      this.storage.get(key, result => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          const data = result[key];
          if (data === undefined) {
            resolve(null);
          } else {
            // 解压缩或其他后处理
            resolve(this.processDataFromStorage(data) as T);
          }
        }
      });
    });
  }
  
  /**
   * 删除存储项
   */
  async remove(key: StorageKey): Promise<void> {
    return new Promise((resolve, reject) => {
      this.storage.remove(key, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.storage.clear(() => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * 获取所有键
   */
  async keys(): Promise<StorageKey[]> {
    return new Promise((resolve, reject) => {
      this.storage.get(null, result => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(Object.keys(result || {}));
        }
      });
    });
  }
  
  /**
   * 检查键是否存在
   */
  async has(key: StorageKey): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.storage.get(key, result => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(key in result);
        }
      });
    });
  }
  
  /**
   * 处理准备存储的数据
   * 可以在这里添加压缩等功能
   */
  private processDataForStorage<T>(data: T): any {
    // 简单实现，实际使用可以添加压缩等逻辑
    return data;
  }
  
  /**
   * 处理从存储获取的数据
   */
  private processDataFromStorage<T>(data: any): T {
    // 对应于processDataForStorage的逆操作
    return data as T;
  }
}
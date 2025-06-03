import { BaseStorageAdapter } from './base-adapter.js';
import { StorageKey, StorageItemOptions } from '../storage-types.js';

/**
 * localStorage适配器选项
 */
export interface LocalStorageOptions {
  /** 使用sessionStorage而非localStorage */
  useSessionStorage?: boolean;
}

/**
 * Web Storage适配器 (localStorage/sessionStorage)
 */
export class WebStorageAdapter extends BaseStorageAdapter {
  private storage: Storage;
  
  /**
   * 构造函数
   * @param options 选项
   */
  constructor(options: LocalStorageOptions = {}) {
    super('WebStorage');
    
    // 选择使用 localStorage 或 sessionStorage
    this.storage = options.useSessionStorage ? 
      window.sessionStorage : 
      window.localStorage;
  }
  
  /**
   * 检查存储是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const testKey = '__storage_test__';
      this.storage.setItem(testKey, '1');
      this.storage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  /**
   * 设置存储项
   */
  async set<T>(key: StorageKey, data: T): Promise<void> {
    try {
      const serialized = JSON.stringify(data);
      this.storage.setItem(key, serialized);
    } catch (e) {
      this.logger.error(`无法设置存储项: ${key}`, e);
      throw e;
    }
  }
  
  /**
   * 获取存储项
   */
  async get<T>(key: StorageKey): Promise<T | null> {
    try {
      const item = this.storage.getItem(key);
      if (item === null) {
        return null;
      }
      try {
        return JSON.parse(item) as T;
      } catch (e) {
        this.logger.error(`[localStorage] 反序列化失败: ${e instanceof Error ? e.message : e}, 原始内容: ${item}`);
        return null;
      }
    } catch (e) {
      this.logger.error(`无法获取存储项: ${key}`, e);
      return null;
    }
  }
  
  /**
   * 删除存储项
   */
  async remove(key: StorageKey): Promise<void> {
    this.storage.removeItem(key);
  }
  
  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    this.storage.clear();
  }
  
  /**
   * 获取所有键
   */
  async keys(): Promise<StorageKey[]> {
    const keys: StorageKey[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key !== null) {
        keys.push(key);
      }
    }
    return keys;
  }
  
  /**
   * 检查键是否存在
   */
  async has(key: StorageKey): Promise<boolean> {
    return this.storage.getItem(key) !== null;
  }
}
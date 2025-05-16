import { BaseStorageAdapter } from './base-adapter.js';
import { StorageKey, StorageItemOptions } from '../storage-types.js';

/**
 * localStorage适配器选项
 */
export interface MemoryStorageOptions {

}

/**
 * 内存存储适配器
 * 主要用于测试和调试
 */
export class MemoryStorageAdapter extends BaseStorageAdapter {
  private storage: Map<StorageKey, any> = new Map();
  
  constructor(options: MemoryStorageOptions = {}) {
    super('MemoryStorage');
  }
  
  /**
   * 检查存储是否可用
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }
  
  /**
   * 设置存储项
   */
  async set<T>(key: StorageKey, data: T): Promise<void> {
    this.storage.set(key, data);
  }
  
  /**
   * 获取存储项
   */
  async get<T>(key: StorageKey): Promise<T | null> {
    if (this.storage.has(key)) {
      return this.storage.get(key) as T;
    }
    return null;
  }
  
  /**
   * 删除存储项
   */
  async remove(key: StorageKey): Promise<void> {
    this.storage.delete(key);
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
    return Array.from(this.storage.keys());
  }
  
  /**
   * 检查键是否存在
   */
  async has(key: StorageKey): Promise<boolean> {
    return this.storage.has(key);
  }
}
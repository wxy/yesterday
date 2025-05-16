import { StorageAdapter, StorageKey, StorageItemOptions } from '../storage-types.js';
import { Logger } from '../../logger/logger.js';

/**
 * 基础存储适配器抽象类
 */
export abstract class BaseStorageAdapter implements StorageAdapter {
  protected logger: Logger;
  
  constructor(loggerName: string) {
    this.logger = new Logger(loggerName);
  }
  
  abstract isAvailable(): Promise<boolean>;
  abstract set<T>(key: StorageKey, data: T, options?: StorageItemOptions): Promise<void>;
  abstract get<T>(key: StorageKey): Promise<T | null>;
  abstract remove(key: StorageKey): Promise<void>;
  abstract clear(): Promise<void>;
  abstract keys(): Promise<StorageKey[]>;
  abstract has(key: StorageKey): Promise<boolean>;
}
import { StorageKey } from './storage-types.js';

/**
 * 存储适配器接口
 * 所有存储后端实现必须遵循此接口
 */
export interface StorageAdapter {
  /**
   * 检查适配器是否可用
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * 初始化适配器
   */
  init(): Promise<void>;
  
  /**
   * 获取存储项
   * @param key 键
   */
  get<T>(key: StorageKey): Promise<T | null>;
  
  /**
   * 设置存储项
   * @param key 键
   * @param value 值
   */
  set<T>(key: StorageKey, value: T): Promise<void>;
  
  /**
   * 删除存储项
   * @param key 键
   */
  remove(key: StorageKey): Promise<void>;
  
  /**
   * 检查键是否存在
   * @param key 键
   */
  has(key: StorageKey): Promise<boolean>;
  
  /**
   * 清空存储
   */
  clear(): Promise<void>;
  
  /**
   * 获取所有键
   */
  keys(): Promise<StorageKey[]>;
  
  // 可选的批量操作方法
  /**
   * 批量获取多个键的值
   */
  getMany?<T>(keys: StorageKey[]): Promise<Record<StorageKey, T>>;
  
  /**
   * 批量设置多个键值对
   */
  setMany?<T>(items: Record<StorageKey, T>): Promise<void>;
  
  /**
   * 批量删除多个键
   */
  removeMany?(keys: StorageKey[]): Promise<void>;
}
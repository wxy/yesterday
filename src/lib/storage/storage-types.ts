import { Logger } from '../logger/logger.js';

/**
 * 存储键类型
 */
export type StorageKey = string;

/**
 * 存储项元数据
 */
export interface StorageItemMeta {
  /** 最后更新时间 */
  updatedAt: number;
  /** 版本号 */
  version?: number;
  /** 过期时间 (毫秒) */
  expiresIn?: number;
}

/**
 * 存储项类型
 */
export interface StorageItem<T = any> {
  /** 存储的数据 */
  data: T;
  /** 元数据 */
  meta: StorageItemMeta;
}

/**
 * 存储更改事件类型
 */
export type StorageChangeType = 'create' | 'update' | 'delete' | 'clear';

/**
 * 存储更改事件
 */
export interface StorageChangeEvent<T = any> {
  /** 键 */
  key: StorageKey | null;
  /** 更改类型 */
  type: StorageChangeType;
  /** 旧值 */
  oldValue?: T;
  /** 新值 */
  newValue?: T;
  /** 命名空间 */
  namespace: string;
}

/**
 * 存储事件处理器
 */
export type StorageEventHandler<T = any> = (event: StorageChangeEvent<T>) => void;

/**
 * 存储选项
 */
export interface StorageOptions {
  /** 命名空间 */
  namespace?: string;
  /** 默认项过期时间 (毫秒) */
  defaultExpirationTime?: number;
  /** 序列化器 */
  serializer?: StorageSerializer;
  /** 日志记录器 */
  logger?: Logger;
}

/**
 * 存储适配器接口
 */
export interface StorageAdapter {
  // 必需方法
  isAvailable(): Promise<boolean>;
  get<T>(key: StorageKey): Promise<T | null>;
  set<T>(key: StorageKey, value: T): Promise<void>;
  remove(key: StorageKey): Promise<void>;
  has(key: StorageKey): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<StorageKey[]>;
  
  // 可选的批量操作方法，为了后续扩展
  getMany?<T>(keys: StorageKey[]): Promise<Record<StorageKey, T | null>>;
  setMany?<T>(items: Record<StorageKey, T>): Promise<void>;
  removeMany?(keys: StorageKey[]): Promise<void>;
}

/**
 * 存储项选项
 */
export interface StorageItemOptions {
  /** 过期时间 (毫秒) */
  expiresIn?: number;
  /** 版本 */
  version?: number;
}

/**
 * 序列化器接口
 */
export interface StorageSerializer {
  /** 序列化 */
  serialize<T>(data: T): string;
  
  /** 反序列化 */
  deserialize<T>(data: string): T;
}
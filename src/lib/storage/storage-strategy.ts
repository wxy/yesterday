import { Logger } from '../logger/logger.js';
import { StorageAdapter } from './storage-types.js';
import { ChromeStorageAdapter } from './adapters/chrome-storage.js';
import { WebStorageAdapter } from './adapters/local-storage.js';
import { MemoryStorageAdapter } from './adapters/memory-storage.js';
import { IndexedDBAdapter } from './adapters/indexed-db.js';

/**
 * 存储后端类型
 */
export type StorageBackendType = 
  | 'chrome-local'   // Chrome本地存储
  | 'chrome-sync'    // Chrome同步存储
  | 'chrome-session' // Chrome会话存储
  | 'web-storage'    // Web存储(localStorage)
  | 'indexed-db'     // IndexedDB存储
  | 'memory'         // 内存存储
  | 'custom';        // 自定义存储

/**
 * 存储后备策略
 */
export type StorageFallbackStrategy = 
  | 'auto'    // 自动回退到可用的后端
  | 'strict'; // 严格使用指定后端，失败时抛出错误

/**
 * 存储策略配置
 */
export interface StorageStrategyConfig {
  /** 默认存储后端 */
  defaultBackend: StorageBackendType;
  
  /** 后备存储后端列表(按优先级排序) */
  fallbacks?: StorageBackendType[];
  
  /** 后备策略 */
  fallbackStrategy: StorageFallbackStrategy;
  
  /** 每个后端的特定选项 */
  backendOptions: Record<StorageBackendType, any>;
}

/**
 * 存储策略管理器
 * 负责根据配置创建合适的存储适配器
 */
export class StorageStrategy {
  private config: StorageStrategyConfig;
  private logger: Logger;
  private adaptersCache: Map<string, StorageAdapter> = new Map();
  
  /**
   * 构造函数
   * @param config 存储策略配置
   */
  constructor(config: Partial<StorageStrategyConfig> = {}) {
    this.config = {
      // 默认配置
      defaultBackend: 'chrome-local',
      fallbacks: ['web-storage', 'memory'],
      fallbackStrategy: 'auto',
      backendOptions: {
        'chrome-local': {},
        'chrome-sync': {},
        'chrome-session': {},
        'web-storage': {},
        'indexed-db': {}, // 添加 IndexedDB 选项
        'memory': {},
        'custom': {}
      },
      ...config
    };
    
    this.logger = new Logger('StorageStrategy');
  }
  
  /**
   * 获取存储适配器
   * @param backendType 指定后端类型(可选)
   */
  async getAdapter(backendType?: StorageBackendType): Promise<StorageAdapter | null> {
    // 获取要使用的后端类型
    const type = backendType || this.config.defaultBackend;
    
    // 如果缓存中已有此适配器，则直接返回
    if (this.adaptersCache.has(type)) {
      return this.adaptersCache.get(type)!;
    }
    
    try {
      let adapter: StorageAdapter | null = null;
      
      switch(type) {
        case 'chrome-local':
          adapter = new ChromeStorageAdapter({ 
            type: 'local', 
            ...this.getBackendOptions(type) 
          });
          break;
          
        case 'chrome-sync':
          adapter = new ChromeStorageAdapter({ 
            type: 'sync', 
            ...this.getBackendOptions(type) 
          });
          break;
          
        case 'chrome-session':
          adapter = new ChromeStorageAdapter({ 
            type: 'session', 
            ...this.getBackendOptions(type) 
          });
          break;
          
        case 'web-storage':
          adapter = new WebStorageAdapter(this.getBackendOptions(type));
          break;
          
        case 'memory':
          adapter = new MemoryStorageAdapter();
          break;
          
        case 'indexed-db':
            adapter = new IndexedDBAdapter(this.getBackendOptions(type));
          break;
          
        case 'custom':
          const customAdapter = this.getBackendOptions(type)?.adapter;
          if (!customAdapter) {
            throw new Error('未提供自定义存储适配器实例');
          }
          adapter = customAdapter;
          break;
          
        default:
          throw new Error(`不支持的存储后端类型: ${type}`);
      }
      
      // 验证适配器可用性
      if (adapter) {
        const isAvailable = await adapter.isAvailable();
        if (isAvailable) {
          this.adaptersCache.set(type, adapter);
          return adapter;
        }
      }
      
      // 如果请求的适配器不可用，则尝试回退
      return this.fallbackToNextAdapter(type);
    } catch (error) {
      this.logger.error(`获取存储适配器失败: ${type}`, error);
      return this.fallbackToNextAdapter(type);
    }
  }
  
  /**
   * 创建指定类型的存储适配器
   * @param type 后端类型
   */
  private async createAdapter(type: StorageBackendType): Promise<StorageAdapter | null> {
    const cacheKey = `${type}:${JSON.stringify(this.getBackendOptions(type))}`;
    if (this.adaptersCache.has(cacheKey)) {
      return this.adaptersCache.get(cacheKey)!;
    }
    
    let adapter: StorageAdapter | null = null;
    
    try {
      switch (type) {
        case 'chrome-local':
          adapter = new ChromeStorageAdapter({ 
            type: 'local', 
            ...this.getBackendOptions(type) 
          });
          break;
          
        case 'chrome-sync':
          adapter = new ChromeStorageAdapter({ 
            type: 'sync', 
            ...this.getBackendOptions(type) 
          });
          break;
          
        case 'chrome-session':
          adapter = new ChromeStorageAdapter({ 
            type: 'session', 
            ...this.getBackendOptions(type) 
          });
          break;
          
        case 'web-storage':
          adapter = new WebStorageAdapter(this.getBackendOptions(type));
          break;
          
        case 'memory':
          adapter = new MemoryStorageAdapter();
          break;
        
        case 'indexed-db':
          adapter = new IndexedDBAdapter(this.getBackendOptions(type));
          break;
        
        case 'custom':
          const customAdapter = this.getBackendOptions(type)?.adapter;
          if (!customAdapter) {
            throw new Error('未提供自定义存储适配器实例');
          }
          adapter = customAdapter;
          break;
          
        default:
          throw new Error(`不支持的存储后端类型: ${type}`);
      }
      
      // 检查适配器是否可用
      if (adapter && !(await adapter.isAvailable())) {
        this.logger.warn(`存储后端 ${type} 不可用`);
        return null;
      }
      
      // 缓存适配器实例
      if (adapter) {
        this.adaptersCache.set(cacheKey, adapter);
      }
      
      return adapter;
    } catch (error) {
      this.logger.error(`创建存储后端 ${type} 时出错`, error);
      return null;
    }
  }
  
  /**
   * 获取指定后端的选项
   * @param type 后端类型
   */
  private getBackendOptions(type: StorageBackendType): any {
    return this.config.backendOptions?.[type] || {};
  }
  
  /**
   * 更新策略配置
   * @param config 新配置
   */
  updateConfig(config: Partial<StorageStrategyConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    
    // 清除适配器缓存，以便重新创建
    this.adaptersCache.clear();
  }
  
  /**
   * 回退到下一个适配器
   * @param failedType 当前失败的后端类型
   */
  private async fallbackToNextAdapter(failedType: StorageBackendType): Promise<StorageAdapter | null> {
    if (this.config.fallbacks && this.config.fallbacks.length > 0) {
      for (const fallbackType of this.config.fallbacks) {
        if (fallbackType !== failedType) {
          try {
            const adapter = await this.createAdapter(fallbackType);
            if (adapter) {
              this.logger.info(`已回退到存储后端: ${fallbackType}`);
              return adapter;
            }
          } catch (error) {
            this.logger.debug(`备选存储后端 ${fallbackType} 不可用`, error);
          }
        }
      }
    }
    
    // 最后回退到内存存储
    this.logger.warn('所有配置的存储后端都不可用，回退到内存存储');
    return new MemoryStorageAdapter();
  }
}
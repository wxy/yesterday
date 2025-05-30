// 导出类型
export * from './storage-types.js';
export * from './storage-strategy.js';

// 导出管理器
export { StorageManager } from './storage-manager.js';

// 导出适配器
export { BaseStorageAdapter } from './adapters/base-adapter.js';
export { ChromeStorageAdapter } from './adapters/chrome-storage.js';
export { WebStorageAdapter } from './adapters/local-storage.js';
export { MemoryStorageAdapter } from './adapters/memory-storage.js';
export { IndexedDBAdapter } from './adapters/indexed-db.js';

// 导出序列化器
export { JsonSerializer } from './serializers/json-serializer.js';

// 导入
import { StorageManager } from './storage-manager.js';
import { StorageOptions } from './storage-types.js';
import { ChromeStorageAdapter } from './adapters/chrome-storage.js';
import { WebStorageAdapter } from './adapters/local-storage.js';
import { MemoryStorageAdapter } from './adapters/memory-storage.js';
import { IndexedDBAdapter } from './adapters/indexed-db.js';
import { StorageStrategy, StorageStrategyConfig } from './storage-strategy.js';
import { storageConfig } from './config/storage-config.js'; // 导入存储配置

/**
 * 存储工厂 - 提供多种方式创建存储实例
 */
export const createStorage = {
  /**
   * 创建基于策略的存储
   * @param config 策略配置，默认使用 storage-config.ts 中定义的配置
   * @param options 存储选项
   */
  withStrategy(config?: Partial<StorageStrategyConfig>, options?: StorageOptions) {
    // 使用导入的 storageConfig 作为默认配置
    const finalConfig = config ? { ...storageConfig, ...config } : storageConfig;
    const strategy = new StorageStrategy(finalConfig);
    return new StorageManager(strategy, options);
  },
  
  /**
   * 创建基于特定适配器的存储
   * @param adapter 存储适配器
   * @param options 存储选项
   */
  withAdapter(adapter: any, options?: StorageOptions) {
    return new StorageManager(adapter, options);
  },
  
  /**
   * 创建使用Chrome本地存储的存储实例
   * @param options 存储选项
   */
  chromeLocal(options?: StorageOptions) {
    // 使用 storageConfig 中的 chrome-local 配置
    const adapterConfig = storageConfig.backendOptions['chrome-local'] || {};
    return this.withAdapter(new ChromeStorageAdapter({ 
      type: 'local', 
      ...adapterConfig 
    }), options);
  },
  
  /**
   * 创建使用Chrome同步存储的存储实例
   * @param options 存储选项
   */
  chromeSync(options?: StorageOptions) {
    // 使用 storageConfig 中的 chrome-sync 配置
    const adapterConfig = storageConfig.backendOptions['chrome-sync'] || {};
    return this.withAdapter(new ChromeStorageAdapter({ 
      type: 'sync',
      ...adapterConfig 
    }), options);
  },
  
  /**
   * 创建使用localStorage的存储实例
   * @param options 存储选项
   */
  localStorage(options?: StorageOptions) {
    // 使用 storageConfig 中的 web-storage 配置
    const adapterConfig = storageConfig.backendOptions['web-storage'] || {};
    return this.withAdapter(new WebStorageAdapter(adapterConfig), options);
  },
  
  /**
   * 创建使用内存存储的存储实例
   * @param options 存储选项
   */
  memory(options?: StorageOptions) {
    // 使用 storageConfig 中的 memory 配置
    const adapterConfig = storageConfig.backendOptions['memory'] || {};
    return this.withAdapter(new MemoryStorageAdapter(adapterConfig), options);
  },
  
  /**
   * 创建使用IndexedDB的存储实例
   * @param options 存储选项
   */
  indexedDB(options?: StorageOptions) {
    // 使用 storageConfig 中的 indexed-db 配置
    const adapterConfig = storageConfig.backendOptions['indexed-db'] || {};
    return this.withAdapter(new IndexedDBAdapter(adapterConfig), options);
  }
};

// 创建默认的基于策略的存储实例，使用 storageConfig
export const storage = createStorage.withStrategy( storageConfig );

// 默认数据库名建议统一为 yesterday 或 ystd，表名/前缀建议统一为 browsing_visits_、browsing_summary_、highlight_records_、page_snapshots_、record_logs_
/**
 * 存储系统配置
 */
import { StorageStrategyConfig } from '../storage-strategy.js';

export const storageConfig: StorageStrategyConfig = {
  // 默认存储后端
  defaultBackend: 'indexed-db',
  
  // 后备存储后端
  fallbacks: ["chrome-sync"],
  
  // 后备策略
  fallbackStrategy: 'strict',
  
  // 后端特定选项
  backendOptions: {
    // Chrome本地存储特定选项
    'chrome-local': {
      // 可选: 存储命名空间前缀
      namespace: 'ext_'
    },
    
    // Chrome同步存储特定选项
    'chrome-sync': {
      compressLargeObjects: true,
      compressionThreshold: 8000 // 接近Chrome同步存储单项8KB限制
    },
    
    // Chrome会话存储特定选项
    'chrome-session': {
      // 会话存储不需要特殊配置
    },
    
    // Web存储特定选项
    'web-storage': {
      // localStorage 或 sessionStorage
      storageType: 'localStorage',
      // 可选: 项目前缀
      keyPrefix: 'ext_'
    },
    
    // IndexedDB特定选项
    'indexed-db': {
      // 统一 dbName: 'yesterday'，所有 objectStores/keyPrefix 建议统一为 browsing_visits_、browsing_summary_、highlight_records_、page_snapshots_、record_logs_
      dbName: 'yesterday',
      version: 1,
      objectStores: [
        {
          name: 'browsing_visits', // 只保留一个主 objectStore，所有数据用 key 前缀区分
          keyPath: 'key',
          indices: [
            { name: 'updatedAt', keyPath: 'meta.updatedAt' }
          ]
        }
      ]
    },
    
    // 内存存储特定选项
    'memory': {
      // 最大缓存项数量 (可选)
      maxItems: 1000,
      // 是否在扩展重启后清除 (默认true)
      clearOnRestart: true
    },
    
    // 自定义存储特定选项
    'custom': {
      // 自定义存储的配置在这里
    }
  }
};

export default storageConfig;
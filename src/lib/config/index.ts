import { ConfigManager } from './config-manager.js';
import { getDefaultConfig, validateConfigs } from './config-utils.js';
import type { ConfigSchema } from './configs.js';

// 获取默认配置
const defaultConfig = getDefaultConfig();

// 创建并导出配置实例
export type AppConfig = ConfigSchema;
const configManager = new ConfigManager<ConfigSchema>(defaultConfig as any, 'yesterday_config');

// 初始化方法
export function initConfig() {
  if (process.env.NODE_ENV === 'development') {
    validateConfigs();
  }
}

// 配置变更全局通知（所有 context 均可监听）
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.yesterday_config) {
      configManager.init();
      // 可选：可在此处广播自定义消息给其它业务模块
    }
  });
}

// 导出单例实例
export const config = configManager;

// 导出类型和API
export * from './config-types.js';
export { ConfigSchema } from './configs.js';
export { validateConfigs } from './config-utils.js';
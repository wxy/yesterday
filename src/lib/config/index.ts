import { ConfigManager } from './config-manager.js';
import { getDefaultConfig, getConfigUIMetadata, validateConfigs } from './config-utils.js';
import type { ConfigSchema } from './configs.js';

// 获取默认配置
const defaultConfig = getDefaultConfig();

// 创建并导出配置实例
export type AppConfig = ConfigSchema;
const configManager = new ConfigManager<ConfigSchema>(defaultConfig as any, 'extension_config');

// 设置UI元数据
configManager.setUIMetadata(getConfigUIMetadata());

// 初始化方法
export function initConfig() {
  if (process.env.NODE_ENV === 'development') {
    validateConfigs();
  }
}

// 导出单例实例
export const config = configManager;

// 导出类型和API
export * from './config-types.js';
export { ConfigSchema } from './configs.js';
export { validateConfigs } from './config-utils.js';
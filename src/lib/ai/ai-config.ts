// 统一的 AI 服务配置业务层封装
// 依赖 config 的通用 get/set
import { config } from '../config/index.js';
import { AIManager } from './ai-manager.js';

export interface AiConfig {
  serviceId: string; // 'ollama' | 'openai' | ...
  model?: string;
  url?: string;
  apiKey?: string;
  [key: string]: any;
}

const AI_CONFIG_KEY = 'aiServiceConfig';

export async function getCurrentAiConfig(): Promise<AiConfig> {
  // 修复：始终从 config.getAll() 获取全量配置后取 aiServiceConfig 字段，避免只查一级字段导致读取不到
  const allConfig = await (config as any).getAll();
  return allConfig[AI_CONFIG_KEY] || { serviceId: 'ollama' };
}

export async function setAiConfig(configUpdate: Partial<AiConfig>): Promise<void> {
  // 先获取当前配置，合并后再 set
  const prev = await getCurrentAiConfig();
  await (config as any).set(AI_CONFIG_KEY, { ...prev, ...configUpdate });
  // 清空 AI 服务缓存
  if (typeof AIManager.clearCache === 'function') {
    AIManager.clearCache();
  }
  // 通知前端和后台刷新 AI 配置缓存
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'ai-config' } });
    } catch {}
  }
}

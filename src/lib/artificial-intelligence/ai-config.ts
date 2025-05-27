// 统一的 AI 服务配置业务层封装
// 依赖 config 的通用 get/set
import { config } from '../config/index.js';

export interface AiConfig {
  serviceId: string; // 'ollama' | 'openai' | ...
  model?: string;
  url?: string;
  apiKey?: string;
  [key: string]: any;
}

const AI_CONFIG_KEY = 'aiServiceConfig';

export async function getCurrentAiConfig(): Promise<AiConfig> {
  // 直接用 config.get，AI 配置建议单独命名空间
  return (await (config as any).get(AI_CONFIG_KEY)) || { serviceId: 'ollama' };
}

export async function setAiConfig(configUpdate: Partial<AiConfig>): Promise<void> {
  // 先获取当前配置，合并后再 set
  const prev = await getCurrentAiConfig();
  await (config as any).set(AI_CONFIG_KEY, { ...prev, ...configUpdate });
}

import { AIManager } from './ai-manager.js';
import { getCurrentAiConfig } from '../ai/ai-config.js';

// 工厂：根据配置选择当前激活的 AI 服务
export async function getActiveAIService() {
  const config = await getCurrentAiConfig();
  const preferredId = config?.serviceId;
  return AIManager.instance.getAvailableService(preferredId);
}

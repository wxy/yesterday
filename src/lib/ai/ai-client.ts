// filepath: src/lib/ai/ai-client.ts
/**
 * 通用 AI 客户端，业务层唯一入口
 * 根据配置动态选择并调用对应的 AI 服务
 */
import { AiMessage, AiChatOptions, AiChatResponse, getAiService } from './ai-service.js';
import { getCurrentAiConfig } from './ai-config.js';

/**
 * 统一对话接口
 * @param messages 对话历史
 * @param options 额外参数（可覆盖配置）
 */
export async function chat(messages: AiMessage[], options: AiChatOptions = {}): Promise<AiChatResponse> {
  console.log('[ai-client] chat called', { messages, options });
  // 获取当前配置（如服务类型、API地址、模型名等）
  const aiConfig = await getCurrentAiConfig();
  const serviceId = options.serviceId || aiConfig.serviceId || 'ollama';
  const service = getAiService(serviceId);
  if (!service) {
    throw new Error(`未找到 AI 服务: ${serviceId}`);
  }
  // 合并配置参数，优先 options
  const mergedOptions = { ...aiConfig, ...options };

  // 支持全局超时
  if (mergedOptions.timeoutMs && typeof mergedOptions.timeoutMs === 'number') {
    const controller = new AbortController();
    mergedOptions.signal = controller.signal;
    return Promise.race([
      service.chat(messages, mergedOptions),
      new Promise<AiChatResponse>((_, reject) =>
        setTimeout(() => {
          controller.abort();
          reject(new Error('AI 分析超时'));
        }, mergedOptions.timeoutMs)
      )
    ]);
  } else {
    return service.chat(messages, mergedOptions);
  }
}

// 可扩展更多统一方法，如 complete、embedding 等

// filepath: src/lib/ai/ollama-service.ts
import { AiService, AiMessage, AiChatOptions, AiChatResponse } from './ai-service.js';
import { chatWithOllama } from './ollama-client.js';

/**
 * Ollama AI 服务适配器，实现通用 AI 服务接口
 */
export class OllamaService implements AiService {
  readonly id = 'ollama';
  readonly label = 'Ollama (本地)';

  async chat(messages: AiMessage[], options: AiChatOptions = {}): Promise<AiChatResponse> {
    console.log('[ollama-service] chat called', { messages, options });
    const { model, url, signal } = options;
    // 兼容 Ollama/OpenAI 消息格式
    const resp = await chatWithOllama({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      model,
      url,
      signal
    });
    console.log('[ollama-service] chatWithOllama 返回', resp);
    // Ollama 返回 choices[0].message.content
    return {
      text: resp.choices?.[0]?.message?.content || '',
      raw: resp
    };
  }
}

// 注册到全局 AI 服务注册表
import { registerAiService } from './ai-service.js';
registerAiService(new OllamaService());

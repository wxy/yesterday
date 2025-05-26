// Chrome AI 服务适配器，实现通用 AI 服务接口
import { AiService, AiMessage, AiChatOptions, AiChatResponse, registerAiService } from './ai-service.js';
import { chromeAiSummarize, checkChromeAiAvailability } from './chrome-ai-client.js';

export class ChromeAiService implements AiService {
  readonly id = 'chrome-ai';
  readonly label = 'Chrome 内置 AI';

  async chat(messages: AiMessage[], options: AiChatOptions = {}): Promise<AiChatResponse> {
    // 只取最后一条用户消息
    const last = messages.filter(m => m.role === 'user').pop();
    console.debug('[chrome-ai-service] chat called', { messages, options });
    // 新增：调用前检测可用性
    const avail = await ChromeAiService.availability();
    if (!avail.available) {
      console.error('[chrome-ai-service] Summarizer 不可用', avail);
      throw new Error(avail.reason || 'Chrome AI Summarizer 不可用');
    }
    try {
      const result = await chromeAiSummarize({
        text: last?.content,
        url: options.url,
        title: options.title,
        signal: options.signal
      });
      console.debug('[chrome-ai-service] chromeAiSummarize 返回', result);
      // summary 为空时也返回提示，避免卡死
      const summary = (result.summary && result.summary.trim()) ? result.summary : '[无摘要结果]';
      return {
        text: summary,
        raw: result
      };
    } catch (e: any) {
      if (e?.message === 'AI 分析超时') {
        return { text: 'AI 分析超时', raw: null };
      }
      throw e;
    }
  }

  static async availability(): Promise<{ available: boolean; reason?: string }> {
    const result = await checkChromeAiAvailability();
    if (!result.available) {
      console.warn('[chrome-ai-service] Chrome AI 不可用', result);
    } else {
      console.info('[chrome-ai-service] Chrome AI 可用');
    }
    return result;
  }
}

// 注册到全局 AI 服务注册表
registerAiService(new ChromeAiService());

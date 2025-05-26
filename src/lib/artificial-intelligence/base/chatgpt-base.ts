import { AIBaseService } from './ai-base.js';

// ChatGPT 类服务基类，便于未来扩展
export abstract class ChatGPTBaseService extends AIBaseService {
  // 可扩展：如对话上下文、消息历史等
  protected conversationId?: string;
  // ...可添加更多通用 chatgpt 能力...
}

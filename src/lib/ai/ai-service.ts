// filepath: src/lib/ai/ai-service.ts
/**
 * 通用 AI 服务接口定义与注册机制
 * 支持多种 AI 服务（如 Ollama、OpenAI、企业 LLM 等）
 */

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatOptions {
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number; // 新增：支持超时
  [key: string]: any; // 允许扩展
}

export interface AiChatResponse {
  text: string; // AI 返回的主要内容
  raw?: any;    // 原始响应
}

export interface AiService {
  /**
   * 聊天/分析接口
   * @param messages 对话历史
   * @param options 额外参数（如模型名、API地址等）
   */
  chat(messages: AiMessage[], options?: AiChatOptions): Promise<AiChatResponse>;
  /**
   * 可选：服务名称
   */
  readonly id: string;
  readonly label: string;

  /**
   * 可选：服务可用性检测（静态方法，部分服务实现）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // @ts-ignore
  // 注意：TS 接口无法直接声明静态方法，此为文档提示
  // static availability?(): Promise<{ available: boolean; reason?: string }>;
}

/**
 * AI 服务注册表
 */
const aiServiceRegistry: Record<string, AiService> = {};

export function registerAiService(service: AiService) {
  aiServiceRegistry[service.id] = service;
}

export function getAiService(id: string): AiService | undefined {
  return aiServiceRegistry[id];
}

export function listAiServices(): AiService[] {
  return Object.values(aiServiceRegistry);
}

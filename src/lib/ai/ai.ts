// filepath: src/lib/ai/ai.js
// 统一 AI 客户端对外入口，仅暴露 chat 方法
import './ollama-service.js';
export { chat } from './ai-client.js';
export * from './ai-service.js';
export type { AiChatResponse } from './ai-service.js';

import { AIManager } from './ai-manager.js';
import { OllamaService } from './ollama/ollama-service.js';
import { ChromeAIService } from './chrome-ai/chrome-ai-service.js';

// 自动注册所有内置 AI 服务
AIManager.instance.register(new OllamaService());
AIManager.instance.register(new ChromeAIService());

// 统一导出
export * from './base/types.js';
export * from './base/ai-base.js';
export * from './base/chatgpt-base.js';
export * from './ai-manager.js';
export * from './ai-factory.js';
export * from './ollama/ollama-service.js';
export * from './chrome-ai/chrome-ai-service.js';

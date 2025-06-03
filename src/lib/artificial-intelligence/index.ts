import { AIManager } from './ai-manager.js';
import { OllamaService } from './ollama/ollama-service.js';
import { ChromeAIService } from './chrome-ai/chrome-ai-service.js';

// 不再自动注册服务，注册逻辑仅在后台脚本中执行

// 统一导出
export * from './base/types.js';
export * from './base/ai-base.js';
export * from './base/chatgpt-base.js';
export * from './ai-manager.js';
export * from './ai-factory.js';
export * from './ollama/ollama-service.js';
export * from './chrome-ai/chrome-ai-service.js';

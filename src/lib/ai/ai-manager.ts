import type { AIBaseService } from './base/ai-base.js';
import { Logger } from '../logger/logger.js';
import { _, i18n } from '../i18n/i18n.js';
import { OllamaService } from './ollama/ollama-service.js';
import { ChromeAIService } from './chrome-ai/chrome-ai-service.js';

// AI 服务统一注册与调度
export class AIManager {
  private static _instance: AIManager;
  private services: Map<string, AIBaseService> = new Map();
  private logger = new Logger('AIManager');
  private i18n = i18n;
  private static _lastPreferredId: string | undefined;
  private static _lastService: AIBaseService | undefined;

  private constructor() {}

  static get instance() {
    if (!this._instance) this._instance = new AIManager();
    return this._instance;
  }

  static clearCache() {
    this._lastPreferredId = undefined;
    this._lastService = undefined;
  }

  /**
   * 注册 AI 服务，注册时立即检测可用性并记录日志，不可用时不注册
   */
  async register(service: AIBaseService) {
    let available = false;
    try {
      available = await service.isAvailable();
    } catch (e) {
      available = false;
    }
    const status = available ? _('ai_service_available', '可用') : _('ai_service_unavailable', '不可用');
    if (available) {
      this.logger.info('注册 AI 服务: {0}（{1}）', service.name, status);
      this.services.set(service.id, service);
    } else {
      this.logger.warn('注册 AI 服务失败: {0}（{1}）', service.name, status);
    }
  }

  getService(id: string): AIBaseService | undefined {
    return this.services.get(id);
  }

  getAllServices(): AIBaseService[] {
    return Array.from(this.services.values());
  }

  async getAvailableService(preferredId?: string): Promise<AIBaseService | undefined> {
    // 缓存机制：如果 preferredId 没变且服务可用，直接返回上次的实例
    if (preferredId && preferredId === AIManager._lastPreferredId && AIManager._lastService) {
      if (await AIManager._lastService.isAvailable()) return AIManager._lastService;
    }
    if (preferredId) {
      const svc = this.services.get(preferredId);
      if (svc && await svc.isAvailable()) {
        AIManager._lastPreferredId = preferredId;
        AIManager._lastService = svc;
        return svc;
      }
    }
    for (const svc of this.services.values()) {
      if (await svc.isAvailable()) {
        AIManager._lastPreferredId = svc.id;
        AIManager._lastService = svc;
        return svc;
      }
    }
    this.logger.warn('ai_no_service_available', '没有可用的 AI 服务！');
    AIManager._lastPreferredId = undefined;
    AIManager._lastService = undefined;
    return undefined;
  }

  /**
   * 检查所有本地 AI 服务可用性
   * 返回 { available: boolean, details: { [id]: boolean } }
   */
  static async checkAllLocalServicesAvailable(): Promise<{ available: boolean, details: Record<string, boolean> }> {
    const aiManager = AIManager.instance;
    const ollama = aiManager.getService('ollama');
    const chromeAI = aiManager.getService('chrome-ai');
    const details: Record<string, boolean> = {};
    let available = false;
    if (ollama) {
      details['ollama'] = await ollama.isAvailable();
      if (details['ollama']) available = true;
    }
    if (chromeAI) {
      details['chrome-ai'] = await chromeAI.isAvailable();
      if (details['chrome-ai']) available = true;
    }
    return { available, details };
  }

  /**
   * 注册所有内置本地 AI 服务（只在后台调用）
   */
  static async registerAllBuiltInServices() {
    await AIManager.instance.register(new OllamaService());
    await AIManager.instance.register(new ChromeAIService());
  }
}

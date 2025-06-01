import type { AIBaseService } from './base/ai-base.js';
import { Logger } from '../logger/logger.js';
import { i18n } from '../i18n/i18n.js';

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

  register(service: AIBaseService) {
    this.logger.info('注册 AI 服务: {0}', service.name);
    this.services.set(service.id, service);
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
}

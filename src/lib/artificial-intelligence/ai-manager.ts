import type { AIBaseService } from './base/ai-base.js';
import { Logger } from '../logger/logger.js';
import { i18n } from '../i18n/i18n.js';

// AI 服务统一注册与调度
export class AIManager {
  private static _instance: AIManager;
  private services: Map<string, AIBaseService> = new Map();
  private logger = new Logger('AIManager');
  private i18n = i18n;

  private constructor() {}

  static get instance() {
    if (!this._instance) this._instance = new AIManager();
    return this._instance;
  }

  register(service: AIBaseService) {
    this.logger.info('ai_register_service', '注册 AI 服务: {0}', service.name);
    this.services.set(service.id, service);
  }

  getService(id: string): AIBaseService | undefined {
    return this.services.get(id);
  }

  getAllServices(): AIBaseService[] {
    return Array.from(this.services.values());
  }

  async getAvailableService(preferredId?: string): Promise<AIBaseService | undefined> {
    if (preferredId) {
      const svc = this.services.get(preferredId);
      if (svc && await svc.isAvailable()) return svc;
    }
    for (const svc of this.services.values()) {
      if (await svc.isAvailable()) return svc;
    }
    this.logger.warn('ai_no_service_available', '没有可用的 AI 服务！');
    return undefined;
  }
}

import type { AISummaryCapability, AIReportCapability, PageAISummary, DailyAIReport } from './types.js';
import { Logger } from '../../logger/logger.js';
import { i18n } from '../../i18n/i18n.js';

// AI 服务抽象基类
export abstract class AIBaseService implements AISummaryCapability, AIReportCapability {
  protected logger: Logger;
  protected i18n = i18n;
  abstract readonly id: string;
  abstract readonly name: string;

  constructor(serviceName: string) {
    this.logger = new Logger(serviceName);
  }

  abstract isAvailable(): Promise<boolean>;
  abstract summarizePage(url: string, content: string): Promise<PageAISummary>;
  // AI 服务抽象基类，增加 generateDailyReport 可选参数 options
  abstract generateDailyReport(date: string, pageSummaries: PageAISummary[], options?: { timeout?: number }): Promise<DailyAIReport>;
}

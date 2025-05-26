import { AIBaseService } from '../base/ai-base.js';
import type { PageAISummary, DailyAIReport } from '../base/types.js';
import { _ , _Error } from '../../i18n/i18n.js';

// 迁移自 chrome-ai-client
interface ChromeAiSummarizeOptions {
  url?: string;
  text?: string;
  title?: string;
  signal?: AbortSignal;
}
interface ChromeAiSummarizeResult {
  summary: string;
  highlights?: string[];
  points?: string[];
  suggestion?: string;
  [key: string]: any;
}

async function chromeAiSummarize(options: ChromeAiSummarizeOptions): Promise<ChromeAiSummarizeResult> {
  const summarizerGlobal = (typeof window !== 'undefined' ? (window as any).Summarizer : undefined) || (typeof globalThis !== 'undefined' ? (globalThis as any).Summarizer : undefined);
  if (!summarizerGlobal || typeof summarizerGlobal.availability !== 'function' || typeof summarizerGlobal.create !== 'function') {
    throw new _Error('ai_chrome_summarizer_not_found', '全局 Summarizer API 不存在');
  }
  // 检查可用性
  const availability = await summarizerGlobal.availability();
  if (availability !== 'available') {
    throw new _Error('ai_chrome_summarizer_unavailable', 'Summarizer API 不可用');
  }
  const createOptions: any = {
    sharedContext: options.title || options.url || '',
    type: 'key-points',
    format: 'markdown',
    length: 'medium',
  };
  const summarizer = await summarizerGlobal.create(createOptions);
  if (options.signal) {
    let aborted = false;
    return Promise.race([
      summarizer.summarize(options.text, { context: options.title || options.url || '' }),
      new Promise((_, reject) => {
        options.signal!.addEventListener('abort', () => {
          aborted = true;
          if (typeof summarizer.destroy === 'function') {
            try { summarizer.destroy(); } catch (e) { /* ignore */ }
          }
          reject(new _Error('ai_chrome_timeout', 'AI 分析超时'));
        });
      })
    ]).then((result: any) => result);
  } else {
    return summarizer.summarize(options.text, { context: options.title || options.url || '' });
  }
}

async function checkChromeAiAvailability(): Promise<{ available: boolean; reason?: string }> {
  const summarizerGlobal = (typeof window !== 'undefined' ? (window as any).Summarizer : undefined) || (typeof globalThis !== 'undefined' ? (globalThis as any).Summarizer : undefined);
  if (!summarizerGlobal || typeof summarizerGlobal.availability !== 'function') {
    // 这里直接返回，日志交由上层
    return { available: false, reason: _('ai_chrome_summarizer_not_found', 'Summarizer API 不存在') };
  }
  const availability = await summarizerGlobal.availability();
  if (availability !== 'available') {
    return { available: false, reason: _('ai_chrome_summarizer_unavailable', 'Summarizer API 不可用') };
  }
  return { available: true };
}

export class ChromeAIService extends AIBaseService {
  readonly id = 'chrome-ai';
  readonly name = 'Chrome AI';

  constructor() {
    super('ChromeAIService');
  }

  async isAvailable(): Promise<boolean> {
    const avail = await checkChromeAiAvailability();
    if (!avail.available) {
      this.logger.warn(_('ai_chrome_unavailable', 'Chrome AI 不可用: {0}', avail.reason || '未知原因'));
      return false;
    }
    return true;
  }

  async summarizePage(url: string, content: string): Promise<PageAISummary> {
    this.logger.info(_('ai_chrome_summarize', 'Chrome AI 正在总结页面: {0}', url));
    try {
      const result = await chromeAiSummarize({ url, text: content });
      return {
        summary: result.summary || '',
        highlights: result.highlights || result.points || [],
        specialConcerns: result.suggestion ? [result.suggestion] : [],
        important: /重要|必须|必看|highly recommended|critical/i.test(result.summary || '')
      };
    } catch (e: any) {
      throw new _Error('ai_chrome_summarize_error', 'Chrome AI 总结失败: {0}', e?.message || String(e));
    }
  }

  async generateDailyReport(date: string, pageSummaries: PageAISummary[]): Promise<DailyAIReport> {
    this.logger.info(_('ai_chrome_report', 'Chrome AI 正在生成日报: {0}', date));
    try {
      const summaryText = pageSummaries.map((s, i) => `页面${i + 1}: ${s.summary}`).join('\n');
      const result = await chromeAiSummarize({ text: summaryText });
      const suggestions = result.highlights || result.points || [];
      return {
        date,
        summaries: pageSummaries,
        suggestions
      };
    } catch (e: any) {
      throw new _Error('ai_chrome_report_error', 'Chrome AI 日报生成失败: {0}', e?.message || String(e));
    }
  }
}

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
    let lang = 'zh-CN';
    try {
      lang = (chrome && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') ? chrome.i18n.getUILanguage() : 'zh-CN';
    } catch {}
    this.logger.info(_('ai_chrome_summarize', 'Chrome AI 正在总结页面: {0}', url));
    try {
      const summarizerGlobal = (typeof window !== 'undefined' ? (window as any).Summarizer : undefined) || (typeof globalThis !== 'undefined' ? (globalThis as any).Summarizer : undefined);
      if (!summarizerGlobal || typeof summarizerGlobal.create !== 'function') {
        throw new _Error('ai_chrome_summarizer_not_found', '全局 Summarizer API 不存在');
      }
      // 语言提示
      const langHint = `请用${lang === 'zh-CN' ? '简体中文' : lang}回答。`;
      // 1. 获取 key-points（要点）
      const keyPointsSummarizer = await summarizerGlobal.create({
        sharedContext: langHint,
        type: 'key-points',
        format: 'plain-text',
        length: 'medium',
      });
      let keyPointsResult = await keyPointsSummarizer.summarize(content, { context: url });
      // 2. 获取 tl;dr（简明摘要）
      const tldrSummarizer = await summarizerGlobal.create({
        sharedContext: langHint,
        type: 'tl;dr',
        format: 'plain-text',
        length: 'short',
      });
      let tldrResult = await tldrSummarizer.summarize(content, { context: url });
      // 3. 获取 teaser（建议/关注点）
      let suggestion = '';
      try {
        const teaserSummarizer = await summarizerGlobal.create({
          sharedContext: langHint,
          type: 'teaser',
          format: 'plain-text',
          length: 'short',
        });
        suggestion = await teaserSummarizer.summarize(content, { context: url });
      } catch {}
      // highlights/points 处理 markdown 符号和换行
      function cleanList(arr: any): string[] {
        if (Array.isArray(arr)) {
          return arr.map((s: string) => String(s).replace(/^([*\-•\s]+)+/, '').replace(/\r?\n/g, '').trim()).filter(Boolean);
        } else if (typeof arr === 'string') {
          return arr.split(/\n|•|\-/).map(s => s.replace(/^([*\-•\s]+)+/, '').replace(/\r?\n/g, '').trim()).filter(Boolean);
        }
        return [];
      }
      const summary = (typeof tldrResult === 'string' ? tldrResult : (tldrResult.summary || ''));
      const highlights = cleanList(keyPointsResult);
      const specialConcerns = suggestion ? [suggestion.replace(/^([*\-•\s]+)+/, '').replace(/\r?\n/g, '').trim()] : [];
      const important = /重要|必须|必看|注意|警告|highly recommended|critical|必读|必看|alert|warning/i.test([summary, ...highlights, ...specialConcerns].join(' '));
      return {
        summary,
        highlights,
        specialConcerns,
        important
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

// 访问记录与 AI 分析模块
// src/background/visit-ai.ts
import { storage } from '../lib/storage/index.js';
import { Logger } from '../lib/logger/logger.js';
import { isSystemUrl } from '../lib/browser-events/system-url.js';

const logger = new Logger('visit-ai');

export const VISIT_KEEP_DAYS = 7;

export async function handlePageVisitRecord(data: any) {
  try {
    // 兼容 content-script 可能传递 { payload: {...} } 的情况
    const record = data && data.payload && typeof data.payload === 'object' ? data.payload : data;
    // 字段完整性校验：url、title、id 必须存在且为非空字符串
    if (!record || typeof record.url !== 'string' || !record.url.trim() || typeof record.title !== 'string' || !record.title.trim() || typeof record.id !== 'string' || !record.id.trim()) {
      logger.warn('[内容捕获] 拒绝插入无效访问记录，字段不全', { data });
      return { status: 'invalid' };
    }
    // 兜底：系统页面不记录
    if (isSystemUrl(record.url)) {
      logger.info('[内容捕获] 跳过系统页面', { url: record.url });
      return { status: 'system' };
    }
    if (!('aiResult' in record)) {
      record.aiResult = '正在进行 AI 分析';
    }
    if (!record.visitStartTime || isNaN(new Date(record.visitStartTime).getTime())) {
      // 自动补当前时间
      const now = Date.now();
      record.visitStartTime = now;
      logger.warn('visitStartTime 缺失或非法，已自动补当前时间', { id: record.id, url: record.url, visitStartTime: now });
    }
    const isRefresh = !!record.isRefresh;
    const date = new Date(record.visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let existed = false;
    let updated = false;
    for (const v of visits) {
      if (v.url === record.url) {
        existed = true;
        if (isRefresh) {
          // 刷新：更新内容、时间戳、id、visitCount+1
          v.title = record.title;
          v.mainContent = record.mainContent;
          v.visitStartTime = record.visitStartTime;
          v.id = record.id;
          v.aiResult = record.aiResult;
          v.visitCount = (v.visitCount || 1) + 1;
          updated = true;
        } else {
          // 非刷新：只递增visitCount
          v.visitCount = (v.visitCount || 1) + 1;
          updated = true;
        }
        break;
      }
    }
    if (!existed) {
      record.visitCount = 1;
      visits.push(record);
      updated = true;
      logger.info(`[内容捕获] 已存储访问记录`, { url: record.url, dayId, id: record.id });
    } else if (isRefresh) {
      logger.info(`[内容捕获] 刷新并更新访问记录`, { url: record.url, dayId, id: record.id });
    } else {
      logger.info(`[内容捕获] 跳过重复访问记录，仅递增visitCount`, { url: record.url, dayId, id: record.id });
    }
    if (updated) {
      await storage.set(key, visits);
    }
    await cleanupOldVisits();
    return { status: existed ? (isRefresh ? 'refresh' : 'repeat') : 'new' };
  } catch (err) {
    logger.error('存储页面访问记录失败', err);
    return { status: 'error' };
  }
}

// 移除 ai_analysis 相关逻辑，所有分析结果直接写入 visits_ 表

export async function updateVisitAiResult(
  url: string,
  visitStartTime: number,
  aiResult: any, // 由 string 改为 any，支持对象
  analyzeDuration: number,
  id?: string
) {
  try {
    logger.debug('[AI调试] updateVisitAiResult called', { url, visitStartTime, id, aiResultType: typeof aiResult, aiResult });
    if (!id) {
      logger.error('updateVisitAiResult 缺少 id，无法唯一定位访问记录', { url, visitStartTime, aiResult });
      return;
    }
    const date = new Date(visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let updated = false;
    for (const v of visits) {
      if (v.id === id) {
        logger.debug('[AI调试] 命中访问记录，准备写入 aiResult', { v });
        v.aiResult = aiResult;
        v.analyzeDuration = analyzeDuration;
        updated = true;
        break;
      }
    }
    if (updated) {
      logger.debug('[AI调试] 已更新 visits，准备写入 storage', { visits });
      await storage.set(key, visits);
      logger.info(`[AI] 已更新访问记录的 aiResult`, { url, dayId, id });
      logger.info(`[AI] 分析结果内容`, { id, aiResult });
    } else {
      logger.warn('[AI调试] 未找到匹配的访问记录（仅按 id 匹配），aiResult 未写入', { url, visitStartTime, id });
    }
  } catch (err) {
    logger.error('更新访问记录 aiResult 失败', err);
  }
}

export async function getVisitsByDay(dayId: string) {
  const key = `visits_${dayId}`;
  return (await storage.get<any[]>(key)) || [];
}

export async function cleanupOldVisits() {
  try {
    const allKeys: string[] = await storage.keys();
    const visitKeys = allKeys.filter(k => k.startsWith('visits_'));
    const days = visitKeys.map(k => k.replace('visits_', ''));
    const sortedDays = days.sort().reverse();
    const keepDays = sortedDays.slice(0, VISIT_KEEP_DAYS);
    const removeDays = sortedDays.slice(VISIT_KEEP_DAYS);
    for (const day of removeDays) {
      await storage.remove(`visits_${day}`);
      logger.info(`[内容捕获] 已清理过期访问数据`, { day });
    }
  } catch (err) {
    logger.error('清理过期访问数据失败', err);
  }
}

// ===== 汇总报告相关 =====
import { config } from '../lib/config/index.js';
import { AIManager } from '../lib/artificial-intelligence/ai-manager.js';

/**
 * 获取指定日期的汇总报告（优先本地缓存，若无则自动触发生成）
 */
export async function getSummaryReport(dayId: string) {
  const key = `summary_${dayId}`;
  let summary = await storage.get<any>(key);
  if (summary && summary.summary) return summary;
  // 若无缓存，自动生成
  summary = await generateSummaryReport(dayId, false);
  return summary;
}

/**
 * 生成指定日期的汇总报告（可强制刷新）
 */
export async function generateSummaryReport(dayId: string, force = false) {
  const key = `summary_${dayId}`;
  // 优先读取超时配置，保证前端和AI调用一致
  let requestTimeout = 30000;
  let aiConfig = { serviceId: 'ollama' };
  let aiServiceLabel = 'AI';
  try {
    const allConfig = await config.getAll();
    if (allConfig && allConfig['aiServiceConfig']) aiConfig = allConfig['aiServiceConfig'];
    if (allConfig && allConfig['advanced.requestTimeout']) requestTimeout = allConfig['advanced.requestTimeout'];
    aiServiceLabel = aiConfig.serviceId === 'chrome-ai' ? 'Chrome AI' : (aiConfig.serviceId === 'ollama' ? 'Ollama' : aiConfig.serviceId);
  } catch {}

  if (!force) {
    const cached = await storage.get<any>(key);
    // 兼容老数据结构
    if (cached && (cached.summaries || cached.summary)) return cached;
  }
  // 获取访问记录
  const visits = await getVisitsByDay(dayId);
  // 统计部分
  const total = visits.length;
  const domains = Array.from(new Set(visits.map(v => {
    try { return new URL(v.url).hostname; } catch { return ''; }
  }).filter(Boolean)));
  const keywords = Array.from(new Set(visits.flatMap(v => (v.title || '').split(/\s|,|，|。|\.|;|；/).filter(Boolean))));
  const totalDuration = visits.reduce((sum, v) => sum + (v.analyzeDuration || 0), 0);
  const stats = { total, totalDuration, domains, keywords };
  // 转换为 PageAISummary[]
  const pageSummaries = visits.map(v => {
    if (typeof v.aiResult === 'object' && v.aiResult && v.aiResult.summary) return v.aiResult;
    // 兼容字符串类型
    return { summary: typeof v.aiResult === 'string' ? v.aiResult : '', highlights: [], important: false };
  });
  // 统一调用 generateDailyReport
  let report: any = null;
  try {
    const aiService = await AIManager.instance.getAvailableService(aiConfig.serviceId);
    if (aiService) {
      report = await Promise.race([
        aiService.generateDailyReport(dayId, pageSummaries, { timeout: requestTimeout }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI 汇总超时')), requestTimeout))
      ]);
      // 附加统计和服务名
      report.stats = stats;
      report.aiServiceLabel = aiServiceLabel;
    } else {
      // 无可用 AI 服务，降级为简单统计
      report = {
        date: dayId,
        summaries: pageSummaries,
        suggestions: [],
        stats,
        aiServiceLabel
      };
    }
  } catch (e) {
    // AI 失败，降级为简单统计
    report = {
      date: dayId,
      summaries: pageSummaries,
      suggestions: [],
      stats,
      aiServiceLabel,
      error: (typeof e === 'object' && e && 'message' in e) ? (e as any).message : String(e)
    };
  }
  await storage.set(key, report);
  return report;
}

// 访问记录与 AI 分析模块
// src/background/visit-ai.ts
import { storage } from '../lib/storage/index.js';
import { Logger } from '../lib/logger/logger.js';
import { shouldAnalyzeUrl } from '../lib/utils/url-utils.js';
import { config } from '../lib/config/index.js';
import { messenger } from '../lib/messaging/messenger.js';
import { AIManager } from '../lib/artificial-intelligence/ai-manager.js';
const logger = new Logger('visit-ai');

export const VISIT_KEEP_DAYS = 7;

// ====== 全局活跃时间判断逻辑 ======
let lastActiveTime = 0;

// ====== 全局跨日空闲阈值配置（单位 ms） ======
let crossDayIdleThresholdMs = 6 * 60 * 60 * 1000; // 默认 6 小时
async function updateCrossDayIdleThreshold() {
  try {
    const allConfig = await config.getAll();
    if (allConfig && typeof allConfig['crossDayIdleThreshold'] === 'number') {
      crossDayIdleThresholdMs = allConfig['crossDayIdleThreshold'] * 60 * 60 * 1000;
    }
  } catch {}
}
// 启动时立即加载一次
updateCrossDayIdleThreshold();
// 监听配置变更（如有事件总线可用）
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.yesterday_config) {
      updateCrossDayIdleThreshold();
    }
  });
}

let aiServiceAvailable = true;
// 通过 messenger 监听 AI_SERVICE_UNAVAILABLE
messenger.on('AI_SERVICE_UNAVAILABLE', (msg) => {
  aiServiceAvailable = false;
});

/* 访问记录与 AI 分析相关逻辑
 * 1. handlePageVisitRecord(data): 处理页面访问记录，存储到 visits_ 表
 * 2. updateVisitAiResult(url, visitStartTime, aiResult, analyzeDuration, id): 更新访问记录的 AI 分析结果
 * 3. getVisitsByDay(dayId): 获取指定日期的访问记录
 * 4. cleanupOldVisits(): 清理过期访问记录
 * 5. getSimpleReport(dayId): 获取指定日期的简化洞察报告（只读缓存）
 * 6. generateSimpleReport(dayId, force): 生成指定日期的简化洞察报告（只保留统计、简要总结、建议）
 * 7. handleCrossDayCleanup(): 跨日清理与日报生成任务
 */

/**
 * 处理页面访问记录，存储到 visits_ 表
 * @param data 页面访问记录数据，可能是 { url, title, mainContent, visitStartTime, id, isRefresh } 结构
 * @returns 
 */
export async function handlePageVisitRecord(data: any) {
  try {
    if (!aiServiceAvailable) {
      return { status: 'no_ai_service', message: '未检测到可用的本地 AI 服务，AI 分析已禁用。' };
    }
    // 兼容 content-script 可能传递 { payload: {...} } 的情况
    const record = data && data.payload && typeof data.payload === 'object' ? data.payload : data;
    // 字段完整性校验：url、title、id 必须存在且为非空字符串
    if (!record || typeof record.url !== 'string' || !record.url.trim() || typeof record.title !== 'string' || !record.title.trim() || typeof record.id !== 'string' || !record.id.trim()) {
      logger.warn('[内容捕获] 拒绝插入无效访问记录，字段不全', { data });
      return { status: 'invalid' };
    }
    // 兜底：系统页面不记录
    if (!(await shouldAnalyzeUrl(record.url))) {
      // 跳过分析
      return;
    }
    // 新增：写入 aiServiceLabel（分析中也写入，保证前端可立即显示）
    if (!('aiResult' in record)) {
      record.aiResult = '正在进行 AI 分析';
      // 获取当前 AI 配置
      let aiServiceLabel = 'AI';
      try {
        const allConfig = await config.getAll();
        let aiConfig = allConfig && allConfig['aiServiceConfig'] ? allConfig['aiServiceConfig'] : { serviceId: 'ollama' };
        const labelMap: Record<string, string> = {
          'ollama': 'Ollama 本地',
          'chrome-ai': 'Chrome 内置 AI',
          'openai': 'OpenAI',
          'other': '其它',
        };
        aiServiceLabel = labelMap[aiConfig.serviceId] || aiConfig.serviceId || 'AI';
      } catch {}
      record.aiServiceLabel = aiServiceLabel;
    }
    if (!record.visitStartTime || isNaN(new Date(record.visitStartTime).getTime())) {
      // 自动补当前时间
      const now = Date.now();
      record.visitStartTime = now;
      logger.warn('visitStartTime 缺失或非法，已自动补当前时间', { id: record.id, url: record.url, visitStartTime: now });
    }
    // ====== 关键逻辑：判断 dayId ======
    const now = record.visitStartTime;
    if (!lastActiveTime || now - lastActiveTime > crossDayIdleThresholdMs) {
      lastActiveTime = now;
    }
    let base = now;
    if (now - lastActiveTime < crossDayIdleThresholdMs) {
      base = lastActiveTime;
    }
    const dateObj = new Date(base);
    const dayId = dateObj.toISOString().slice(0, 10);
    const key = `browsing_visits_${dayId}`;
    const isRefresh = !!record.isRefresh;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let existed = false;
    let updated = false;
    for (const v of visits) {
      if (v.url === record.url) {
        existed = true;
        if (isRefresh) {
          // 刷新：更新内容、时间戳、id、visitCount+1，并清空aiResult以触发AI分析
          v.title = record.title;
          v.mainContent = record.mainContent;
          v.visitStartTime = record.visitStartTime;
          v.id = record.id;
          v.aiResult = '';
          v.visitCount = (v.visitCount || 1) + 1;
          updated = true;
        } else {
          // 非刷新：只递增visitCount，但如果内容有变化则清空aiResult重新分析
          v.visitCount = (v.visitCount || 1) + 1;
          if (v.title !== record.title || v.mainContent !== record.mainContent) {
            v.title = record.title;
            v.mainContent = record.mainContent;
            v.aiResult = '';
            v.aiServiceLabel = record.aiServiceLabel || 'AI';
            v.analyzeDuration = undefined;
            logger.info('[内容捕获] 重复访问但内容有变化，已重置分析', { url: record.url, dayId, id: record.id });
          } else {
            logger.info(`[内容捕获] 跳过重复访问记录，更新访问时长和访问次数`, { url: record.url, dayId, id: record.id });
          }
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
      logger.info(`[内容捕获] 刷新并更新访问记录`, { url: record.url, dayId, id: record.id, mainContentLength: record.mainContent ? record.mainContent.length : 0 });
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

/**
 * 更新访问记录的 AI 分析结果
 * @param url 访问的 URL
 * @param visitStartTime 访问开始时间戳
 * @param aiResult AI 分析结果，可以是字符串或对象
 * @param analyzeDuration 分析耗时（毫秒）
 * @param id 访问记录的唯一 ID
 * @param aiServiceLabel 本次分析所用 AI 服务的标签（可选）
 */
export async function updateVisitAiResult(
  url: string,
  visitStartTime: number,
  aiResult: any, // 由 string 改为 any，支持对象
  analyzeDuration: number,
  id?: string,
  aiServiceLabel?: string // 新增参数，标记本次分析所用 AI 服务
) {
  try {
    if (!id) {
      logger.error('updateVisitAiResult 缺少 id，无法唯一定位访问记录', { url, visitStartTime, aiResult });
      return;
    }
    const date = new Date(visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `browsing_visits_${dayId}`; // 原 visits_${dayId}
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let updated = false;
    for (const v of visits) {
      if (v.id === id) {
        v.aiResult = aiResult;
        v.analyzeDuration = analyzeDuration;
        if (aiServiceLabel) v.aiServiceLabel = aiServiceLabel; // 新增：写入 AI 服务名
        updated = true;
        break;
      }
    }
    if (updated) {
      await storage.set(key, visits);
      // 新增：分析结果写入后主动通知侧边栏刷新
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'ai' } });
      }
    } else {
    }
  } catch (err) {
    logger.error('更新访问记录 aiResult 失败', err);
  }
}

/**
 * 获取指定日期的访问记录
 * @param dayId 
 */
export async function getVisitsByDay(dayId: string) {
  const key = `browsing_visits_${dayId}`; // 原 visits_${dayId}
  return (await storage.get<any[]>(key)) || [];
}

/**
 * 清理过期访问记录
 * 保留最近 VISIT_KEEP_DAYS 天的访问记录
 * 过期的将被删除
 */
export async function cleanupOldVisits() {
  try {
    const allKeys: string[] = await storage.keys();
    const visitKeys = allKeys.filter(k => k.startsWith('browsing_visits_'));
    const days = visitKeys.map(k => k.replace('browsing_visits_', ''));
    const sortedDays = days.sort().reverse();
    const keepDays = sortedDays.slice(0, VISIT_KEEP_DAYS);
    const removeDays = sortedDays.slice(VISIT_KEEP_DAYS);
    for (const day of removeDays) {
      await storage.remove(`browsing_visits_${day}`);
      logger.info(`[内容捕获] 已清理过期访问数据`, { day });
    }
  } catch (err) {
    logger.error('清理过期访问数据失败', err);
  }
}

// ===== 简化洞察报告相关 =====


/**
 * 获取指定日期的简化洞察报告（只读缓存，不自动生成）
 * @param dayId 日期字符串（如 '2024-05-29'）
 * @returns 如果存在缓存报告，返回 { dayId, report: { stats, summary, suggestions } }，否则返回 null  
 */
export async function getSimpleReport(dayId: string) {
  const key = `app:browsing_summary_${dayId}`;
  const cached = await storage.get<any>(key);
  return cached && cached.report ? { dayId, report: cached.report } : null;
}

/**
 * 生成指定日期的简化洞察报告（只保留统计、简要总结、建议）
 * force=true 时强制生成
 */
export async function generateSimpleReport(dayId: string, force = false) {
  const key = `app:browsing_summary_${dayId}`;
  if (!force) {
    const cached = await storage.get<any>(key);
    if (cached && cached.report) return { dayId, report: cached.report };
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
  let summary = '';
  let suggestions: string[] = [];
  let aiServiceLabel = 'AI';
  let duration = 0;
  try {
    const aiService = await AIManager.instance.getAvailableService();
    let requestTimeout = 20000;
    try {
      const allConfig = await config.getAll();
      if (allConfig && allConfig['requestTimeout']) requestTimeout = allConfig['requestTimeout'];
      // 读取 AI 配置，获取服务名
      const aiConfig = allConfig && typeof allConfig['aiServiceConfig'] === 'object' ? allConfig['aiServiceConfig'] as { serviceId?: string } : { serviceId: 'ollama' };
      const labelMap: Record<string, string> = {
        'ollama': 'Ollama 本地',
        'chrome-ai': 'Chrome 内置 AI',
        'openai': 'OpenAI',
        'other': '其它',
      };
      aiServiceLabel = aiConfig && aiConfig.serviceId ? (labelMap[aiConfig.serviceId] || aiConfig.serviceId || 'AI') : 'AI';
    } catch {}
    if (aiService && aiService.generateDailyReport) {
      const pageSummaries = visits.map(v => ({
        summary: v.title || '',
        highlights: [],
        important: false,
        mainContent: v.mainContent || ''
      }));
      const t0 = Date.now();
      const aiResult = await aiService.generateDailyReport(dayId, pageSummaries, { timeout: requestTimeout });
      duration = Date.now() - t0;
      if (aiResult.summaries && Array.isArray(aiResult.summaries)) {
        summary = aiResult.summaries.map((s: any) => s.summary).join('\n');
      }
      suggestions = aiResult.suggestions || [];
    }
  } catch (err) {
    logger.error('生成简化洞察报告失败', err);
  }
  // 新增：写入 aiServiceLabel 和 duration 字段
  const report = { stats, summary, suggestions, aiServiceLabel, duration };
  const data = { dayId, report };
  await storage.set(key, data);
  logger.info(`[简化报告] 已生成并缓存 ${dayId} 的报告`, data);
  return data;
}

/**
 * 处理跨日清理和日报生成
 * 1. 删除昨日之前的访问数据及分析
 * 2. 删除昨日之前的日报（洞察）
 * 3. 对昨日数据进行分析，生成洞察日报
 * 4. 通知侧边栏刷新（如果已打开）  
 */
export async function handleCrossDayCleanup() {
  const now = new Date();
  const todayId = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayId = yesterday.toISOString().slice(0, 10);

  // 1. 删除昨日之前的访问数据及分析
  const allKeys = await storage.keys();
  const visitKeys = allKeys.filter(k => k.startsWith('browsing_visits_'));
  for (const key of visitKeys) {
    const day = key.replace('browsing_visits_', '');
    if (day < yesterdayId) {
      await storage.remove(key);
    }
  }
  // 2. 删除昨日之前的日报（洞察）
  const reportKeys = allKeys.filter(k => k.startsWith('app:browsing_summary_'));
  for (const key of reportKeys) {
    const day = key.replace('app:browsing_summary_', '');
    if (day < yesterdayId) {
      await storage.remove(key);
    }
  }
  // 3. 对昨日数据进行分析，生成洞察日报
  await generateSimpleReport(yesterdayId, true);
  // 4. 通知侧边栏刷新（如果已打开）
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE' });
  }
}

/**
 * 统一处理页面访问记录及自动AI分析（主业务入口，供 event-handlers 调用）
 * @param record 访问记录对象
 * @param options { isAnalyze, sourceType }
 */
export async function handlePageVisitAndMaybeAnalyze(record: any, options: { isAnalyze?: boolean, sourceType?: string } = {}) {
  // 统一取 payload 里的主数据
  const visit = record && record.payload && typeof record.payload === 'object' ? record.payload : record;
  // 1. 写入/更新访问记录
  const result = await handlePageVisitRecord(record);
  // 2. 只要 mainContent 存在且应分析，自动触发AI分析
  if (options.isAnalyze !== false) {
    const mainContent = visit.content || visit.mainContent;
    if (mainContent && mainContent.length > 0 && (!visit.aiResult || visit.aiResult === '' || visit.aiResult === '正在进行 AI 分析')) {
      await analyzeVisitRecordById({
        url: visit.url,
        title: visit.title,
        content: mainContent,
        id: visit.id,
        visitStartTime: visit.visitStartTime
      });
    }
  }
  return result;
}

/**
 * 只做AI分析，写回结果（供 event-handlers 调用）
 * @param msg 包含 url、id、content、visitStartTime 等
 */
export async function analyzeVisitRecordById(msg: any) {
  const { url, title, content, id } = msg.payload || msg;
  const visitStartTime = msg.payload?.visitStartTime || msg.visitStartTime || Date.now();
  let dayId = msg.payload?.dayId || msg.dayId;
  if (!dayId) {
    const date = new Date(visitStartTime);
    dayId = date.toISOString().slice(0, 10);
  }
  if (!id) {
    logger.warn('ai_analyze_no_visit_record', 'AI 分析请求缺少 id，无法查找访问记录: {0}', url);
    return { ok: false, error: 'AI 分析请求缺少 id，无法查找访问记录' };
  }
  const visitId = id;
  const key = `browsing_visits_${dayId}`;
  let visits: any[] = (await storage.get<any[]>(key)) || [];
  const visit = visits.find(v => v.id === visitId);
  if (!visit) {
    logger.warn('ai_analyze_no_visit_record', '未找到访问记录: {0}', url);
    return { ok: false, error: '未找到访问记录' };
  }
  if (visit.aiResult && visit.aiResult !== '' && visit.aiResult !== '正在进行 AI 分析') {
    logger.info('ai_analyze_skipped', '已有分析结果，跳过: {0}', url);
    return { ok: true, skipped: true, reason: 'already analyzed' };
  }
  await config.reload();
  const allConfig: any = await config.getAll();
  const aiConfig = allConfig && allConfig['aiServiceConfig'] ? allConfig['aiServiceConfig'] : { serviceId: 'ollama' };
  const aiService = await AIManager.instance.getAvailableService(aiConfig.serviceId);
  const labelMap: Record<string, string> = {
    'ollama': 'Ollama 本地',
    'chrome-ai': 'Chrome 内置 AI',
    'openai': 'OpenAI',
    'other': '其它',
  };
  const aiServiceLabel = labelMap[aiConfig.serviceId] || aiConfig.serviceId || 'AI';
  const analyzeStart = Date.now();
  try {
    if (!aiService) throw new Error('无可用 AI 服务');
    const aiSummary = await aiService.summarizePage(url, content);
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    await updateVisitAiResult(url, visitStartTime, aiSummary, analyzeDuration, visitId, aiServiceLabel);
    return { ok: true, aiContent: aiSummary, analyzeDuration };
  } catch (e: any) {
    logger.error('ai_analyze_error', '分析异常: {0}', url);
    return { ok: false, error: '分析异常' };
  }
}

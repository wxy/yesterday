// 访问记录与 AI 分析模块
// src/background/visit-ai.ts
import { storage } from '../lib/storage/index.js';
import { Logger } from '../lib/logger/logger.js';
import { shouldAnalyzeUrl } from '../lib/utils/url-utils.js';
import { config } from '../lib/config/index.js';
import { messenger } from '../lib/messaging/messenger.js';
import { AIManager } from '../lib/ai/ai-manager.js';
import { taskQueue, AnalysisTaskStatus } from '../lib/ai/task-queue.js';
import { PromptManager } from '../lib/ai/prompt-manager.js';
const logger = new Logger('visit-ai');

export const VISIT_KEEP_DAYS = 7;

// ====== 全局活跃时间判断逻辑 ======
let lastActiveTime = 0;

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
    // 极短停留页面过滤（如小于1.5秒）
    const visitStart = record && record.visitStartTime;
    const visitEnd = record && record.visitEndTime;
    if (visitStart && visitEnd && typeof visitStart === 'number' && typeof visitEnd === 'number') {
      const stayMs = visitEnd - visitStart;
      if (stayMs >= 0 && stayMs < 1500) {
        logger.info('[内容捕获] 跳过极短停留页面', { url: record.url, id: record.id, stayMs });
        return { status: 'skipped', reason: 'short_stay', url: record.url, stayMs };
      }
    }
    
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
    // 新增：写入 aiServiceLabel（不再写 analyzingStartTime，分析任务开始时再写）
    if (!('aiResult' in record)) {
      record.aiResult = '';
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
      // analyzingStartTime 不在此处写入
    }
    if (!record.visitStartTime || isNaN(new Date(record.visitStartTime).getTime())) {
      // 自动补当前时间
      const now = Date.now();
      record.visitStartTime = now;
      logger.warn('visitStartTime 缺失或非法，已自动补当前时间', { id: record.id, url: record.url, visitStartTime: now });
    }
    // ====== 关键逻辑：判断 dayId ======
    const now = record.visitStartTime;
    // 动态获取跨日阈值
    let crossDayIdleThresholdMs = 6 * 60 * 60 * 1000;
    try {
      const allConfig = await config.getAll();
      if (allConfig && typeof allConfig['crossDayIdleThreshold'] === 'number') {
        crossDayIdleThresholdMs = allConfig['crossDayIdleThreshold'] * 60 * 60 * 1000;
      }
    } catch {}
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
        // analysisStatus 只在内容变化时重置
        const contentChanged = (v.title !== record.title || v.mainContent !== record.mainContent);
        if (contentChanged) {
          v.analysisStatus = 'none';
          v.aiResult = '';
          v.analyzeDuration = undefined;
          v.aiServiceLabel = record.aiServiceLabel || 'AI';
          v.title = record.title;
          v.mainContent = record.mainContent;
          updated = true;
          logger.info('[内容捕获] 重复访问但内容有变化，已重置分析', { url: record.url, dayId, id: v.id });
        }
        if (isRefresh) {
          // 刷新：只更新基础字段，不覆盖分析相关字段
          v.title = record.title;
          v.mainContent = record.mainContent;
          v.visitStartTime = record.visitStartTime;
          v.id = record.id;
          // 新增：如果未分析过，刷新时强制重置 analysisStatus/aiResult，确保后续能分析
          if (!v.aiResult || v.aiResult === '' || v.analysisStatus !== 'done') {
            v.analysisStatus = 'none';
            v.aiResult = '';
            v.analyzeDuration = undefined;
            v.aiServiceLabel = record.aiServiceLabel || 'AI';
            logger.info('[内容捕获] 刷新页面且未分析，已重置分析状态', { url: record.url, dayId, id: v.id });
          }
          updated = true;
        } else if (!contentChanged) {
          // 非刷新且内容无变化：只递增visitCount
          v.visitCount = (v.visitCount || 1) + 1;
          logger.info(`[内容捕获] 跳过重复访问记录，更新访问时长和访问次数`, { url: record.url, dayId, id: v.id });
          updated = true;
        }
        break;
      }
    }
    // 只有新访问才 visitCount = 1，刷新不应 visitCount++
    if (!existed) {
      record.visitCount = 1;
      record.analysisStatus = 'none';
      visits.push(record);
      updated = true;
      logger.info(`[内容捕获] 已存储访问记录`, { url: record.url, dayId, id: record.id });
    }
    // 刷新分支已在上方处理，这里无需再 Object.assign 合并，避免覆盖分析字段
    if (updated) {
      await storage.set(key, visits);
      // 新增：访问记录写入后主动通知侧边栏刷新，显示“正在分析中”
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'visit' } });
      }
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
    // 在 updateVisitAiResult 分析完成时，写入 analyzeDuration 并移除 analyzingStartTime
    for (const v of visits) {
      if (v.id === id) {
        v.aiResult = aiResult;
        v.analyzeDuration = analyzeDuration;
        if (aiServiceLabel) v.aiServiceLabel = aiServiceLabel;
        if ('analyzingStartTime' in v) delete v.analyzingStartTime;
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
  const key = `browsing_summary_${dayId}`;
  const cached = await storage.get<any>(key);
  return cached && cached.report ? { dayId, report: cached.report } : null;
}

/**
 * 生成指定日期的简化洞察报告（只保留统计、简要总结、建议）
 * force=true 时强制生成
 */
export async function generateSimpleReport(dayId: string, force = false) {
  const key = `browsing_summary_${dayId}`;
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
      suggestions = parseSuggestions(aiResult.suggestions);
      logger.info('[日报AI内容]', { dayId, summary, suggestions });
    }
  } catch (err) {
    logger.error('生成简化洞察报告失败', err);
  }
  // 新增：写入 aiServiceLabel 和 duration 字段
  const report = { stats, summary, suggestions, aiServiceLabel, duration };
  const data = { dayId, report };
  await storage.set(key, data);
  logger.info(`[简化报告] 已生成并缓存 ${dayId} 的报告`, data);
  // 新增：生成后主动通知侧边栏刷新洞察卡片
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'ai' } });
  }
  return data;
}

/**
 * 处理跨日清理和日报生成
 * 1. 删除昨日之前的访问数据及分析
 * 2. 删除昨日之前的日报（洞察）
 * 3. 对昨日数据进行分析，生成洞察日报（仅当有访问数据时才生成）
 * 4. 通知侧边栏刷新（如果已打开），并强制刷新标签日期
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
  const reportKeys = allKeys.filter(k => k.startsWith('browsing_summary_'));
  for (const key of reportKeys) {
    const day = key.replace('browsing_summary_', '');
    if (day < yesterdayId) {
      await storage.remove(key);
    }
  }
  // 3. 对昨日数据进行分析，生成洞察日报（仅当有访问数据时才生成）
  const yesterdayVisits = await getVisitsByDay(yesterdayId);
  if (yesterdayVisits && yesterdayVisits.length > 0) {
    await queueGenerateSimpleReport(yesterdayId, true);
  } else {
    logger.info(`[跨日清理] 昨日无访问数据，不生成日报`, { yesterdayId });
  }
  // 4. 通知侧边栏刷新（如果已打开），并强制刷新标签日期
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'crossDay' } });
  }
}

/**
 * 统一处理页面访问记录及自动AI分析（主业务入口，供 event-handlers 调用）
 * @param record 访问记录对象
 * @param options { isAnalyze, sourceType }
 */
export async function handlePageVisitAndMaybeAnalyze(record: any, options: { isAnalyze?: boolean, sourceType?: string } = {}) {
  // 统一取 payload 里的主数据
  const visitRaw = record && record.payload && typeof record.payload === 'object' ? record.payload : record;
  // 1. 写入/更新访问记录
  const result = await handlePageVisitRecord(record);
  // 2. 重新从 storage 获取最新 visit，确保分析触发条件准确
  let visit = visitRaw;
  try {
    const dateObj = new Date(visitRaw.visitStartTime);
    const dayId = dateObj.toISOString().slice(0, 10);
    const key = `browsing_visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    const found = visits.find(v => v.id === visitRaw.id);
    if (found) visit = found;
  } catch {}
  // 输出分析触发前的状态
  logger.info('[AI分析触发检查]', {
    id: visit.id,
    url: visit.url,
    analysisStatus: visit.analysisStatus,
    aiResult: visit.aiResult,
    mainContentLen: visit.mainContent ? visit.mainContent.length : 0,
    contentLen: visit.content ? visit.content.length : 0
  });
  // 只要 mainContent 存在且 analysisStatus 为 none/pending，自动触发AI分析
  if (options.isAnalyze !== false) {
    const mainContent = visit.content || visit.mainContent;
    if (mainContent && mainContent.length > 0 && (visit.analysisStatus === 'none' || visit.analysisStatus === 'pending')) {
      logger.info('[AI分析已入队]', { id: visit.id, url: visit.url });
      // 队列式分析
      const analyzeKey = visit.id;
      taskQueue.addTask(async () => {
        await analyzeVisitRecordById({
          url: visit.url,
          title: visit.title,
          content: mainContent,
          id: visit.id,
          visitStartTime: visit.visitStartTime
        });
      }, {
        key: analyzeKey,
        statusCallback: (status: AnalysisTaskStatus) => {
          updateVisitAnalyzeStatus(visit, status);
        }
      });
    }
  }
  return result;
}

// 新增：分析状态反馈，写入 analyzingStatus 字段及时间
function updateVisitAnalyzeStatus(visit: any, status: AnalysisTaskStatus) {
  const now = Date.now();
  if (status === 'pending') {
    visit.analyzingStatus = 'pending';
    visit.analysisStatus = 'pending';
    visit.analyzingQueueTime = now;
  } else if (status === 'running') {
    visit.analyzingStatus = 'running';
    visit.analysisStatus = 'running';
    visit.analyzingStartTime = now;
  } else if (status === 'done') {
    visit.analyzingStatus = 'done';
    visit.analysisStatus = 'done';
  } else if (status === 'failed') {
    visit.analyzingStatus = 'failed';
    visit.analysisStatus = 'failed';
  }
  persistVisitStatus(visit);
}

// 新增：持久化分析状态到 storage
async function persistVisitStatus(visit: any) {
  if (!visit || !visit.id || !visit.visitStartTime) return;
  const date = new Date(visit.visitStartTime);
  const dayId = date.toISOString().slice(0, 10);
  const key = `browsing_visits_${dayId}`;
  const visits: any[] = (await storage.get<any[]>(key)) || [];
  for (const v of visits) {
    if (v.id === visit.id) {
      Object.assign(v, {
        analyzingStatus: visit.analyzingStatus,
        analyzingQueueTime: visit.analyzingQueueTime,
        analyzingStartTime: visit.analyzingStartTime,
        analysisStatus: visit.analysisStatus
      });
      break;
    }
  }
  await storage.set(key, visits);
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'ai' } });
  }
}

/**
 * 只做AI分析，写回结果（供 event-handlers 调用）
 * @param msg 包含 url、id、content、visitStartTime 等
 */
export async function analyzeVisitRecordById(msg: any) {
  try {
    // ====== 新版提示词机制 ======
    const t0 = Date.now();
    let aiResult = '';
    let analyzeDuration = 0;
    let aiServiceLabel = 'AI';
    let prompt = '';
    try {
      const aiService = await AIManager.instance.getAvailableService();
      if (!aiService) throw new Error('无可用AI服务');
      const allConfig = await config.getAll();
      let lang = 'en';
      if (allConfig && allConfig.language && allConfig.language !== 'auto') {
        lang = allConfig.language;
      }
      // 获取系统提示词（如 insight_summary）
      const sysPrompt = await PromptManager.getPromptById('insight_summary', lang);
      if (sysPrompt && sysPrompt.content && sysPrompt.content[lang]) {
        prompt = sysPrompt.content[lang];
        logger.info('[AI分析] 使用系统提示词', { id: sysPrompt.id, lang, prompt });
      } else {
        logger.warn('[AI分析] 未找到指定语言的系统提示词，回退英文', { lang });
        const fallbackPrompt = await PromptManager.getPromptById('insight_summary', 'en');
        prompt = fallbackPrompt && fallbackPrompt.content && fallbackPrompt.content['en'] ? fallbackPrompt.content['en'] : '';
      }
      // 记录 AI 服务名
      if (allConfig && allConfig['aiServiceConfig']) {
        const labelMap: Record<string, string> = {
          'ollama': 'Ollama 本地',
          'chrome-ai': 'Chrome 内置 AI',
          'openai': 'OpenAI',
          'other': '其它',
        };
        const aiConfig = allConfig['aiServiceConfig'];
        aiServiceLabel = labelMap[aiConfig.serviceId] || aiConfig.serviceId || 'AI';
      }
      // 统一调用 summarizePage，prompt 通过上下文传递
      if (typeof aiService.summarizePage === 'function') {
        // 只传 url, content，prompt 通过服务内部读取
        const summary = await aiService.summarizePage(msg.url, msg.content);
        aiResult = typeof summary === 'string' ? summary : (summary.summary || JSON.stringify(summary));
        logger.info('[AI分析完成]', { url: msg.url, id: msg.id, lang, aiServiceLabel });
      } else {
        throw new Error('AI服务不支持 summarizePage 接口');
      }
      analyzeDuration = Date.now() - t0;
    } catch (e: any) {
      logger.error('[AI分析异常]', e);
      aiResult = '[AI分析失败] ' + (e && e.message ? e.message : String(e));
      analyzeDuration = Date.now() - t0;
    }
    // ====== 你的原有分析逻辑结束 ======
    await updateVisitAiResult(msg.url, msg.visitStartTime, aiResult, analyzeDuration, msg.id, aiServiceLabel);
  } catch (err) {
    logger.error('[AI分析任务异常]', err);
  }
}

// ========== 日报（洞察）生成队列与状态流转 ==========

// 日报生成任务队列
const reportQueue: Array<{
  dayId: string;
  force: boolean;
  resolve: (v: any) => void;
  reject: (e: any) => void;
  progressCb?: (status: any) => void;
}> = [];
let reportQueueRunning = false;

// 日报状态映射：{ [dayId]: { status, startTime, duration, aiServiceLabel, errorMsg } }
const reportStatusMap: Record<string, {
  status: 'none' | 'pending' | 'running' | 'done' | 'failed',
  startTime?: number,
  duration?: number,
  aiServiceLabel?: string,
  errorMsg?: string
}> = {};

// 队列调度器
async function runReportQueue() {
  if (reportQueueRunning) return;
  reportQueueRunning = true;
  while (reportQueue.length > 0) {
    const task = reportQueue.shift();
    if (!task) continue;
    const { dayId, force, resolve, reject, progressCb } = task;
    logger.info('[日报生成出队]', { dayId, force, queueLength: reportQueue.length });
    // 标记 pending
    reportStatusMap[dayId] = { status: 'pending', startTime: Date.now() };
    progressCb && progressCb({ ...reportStatusMap[dayId] });
    try {
      // 标记 running
      // aiServiceLabel 需在 generateSimpleReportWithStatus running 阶段写入
      // 但先写 startTime
      reportStatusMap[dayId] = { status: 'running', startTime: reportStatusMap[dayId].startTime };
      progressCb && progressCb({ ...reportStatusMap[dayId] });
      // 调用生成逻辑，传递进度回调
      const result = await generateSimpleReportWithStatus(dayId, force, (progress) => {
        // 进度回调：可扩展
        // running 阶段写入 aiServiceLabel
        if (progress.status === 'running' && progress.aiServiceLabel) {
          reportStatusMap[dayId] = {
            ...reportStatusMap[dayId],
            status: 'running',
            aiServiceLabel: progress.aiServiceLabel,
            startTime: reportStatusMap[dayId].startTime || Date.now()
          };
        } else if (progress.status === 'pending') {
          reportStatusMap[dayId] = {
            ...reportStatusMap[dayId],
            status: 'pending',
            startTime: reportStatusMap[dayId].startTime || Date.now()
          };
        }
        progressCb && progressCb({ ...reportStatusMap[dayId], ...progress });
      });
      // 标记 done
      reportStatusMap[dayId] = {
        status: 'done',
        startTime: reportStatusMap[dayId].startTime,
        duration: result.report?.duration,
        aiServiceLabel: result.report?.aiServiceLabel
      };
      progressCb && progressCb({ ...reportStatusMap[dayId] });
      logger.info('[日报生成完成]', { dayId, duration: result.report?.duration, aiServiceLabel: result.report?.aiServiceLabel });
      resolve(result);
    } catch (err: any) {
      reportStatusMap[dayId] = {
        status: 'failed',
        startTime: reportStatusMap[dayId].startTime,
        errorMsg: err && err.message ? err.message : String(err)
      };
      progressCb && progressCb({ ...reportStatusMap[dayId] });
      logger.error('[日报生成失败]', { dayId, error: err && err.message ? err.message : String(err) });
      reject(err);
    }
  }
  reportQueueRunning = false;
}

// 队列化生成日报（支持进度反馈）
export function queueGenerateSimpleReport(dayId: string, force = false, progressCb?: (status: any) => void) {
  logger.info('[日报生成入队]', { dayId, force, queueLength: reportQueue.length + 1 });
  return new Promise((resolve, reject) => {
    reportQueue.push({ dayId, force, resolve, reject, progressCb });
    runReportQueue();
  });
}

// 支持进度反馈的日报生成
async function generateSimpleReportWithStatus(dayId: string, force = false, progressCb?: (progress: any) => void) {
  // 进度：已排队
  progressCb && progressCb({ status: 'pending' });
  // ...调用原 generateSimpleReport 逻辑...
  const key = `browsing_summary_${dayId}`;
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
  let errorMsg = '';
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
      // 进度：AI 服务已调用
      progressCb && progressCb({ status: 'running', aiServiceLabel });
      const aiResult = await aiService.generateDailyReport(dayId, pageSummaries, { timeout: requestTimeout });
      duration = Date.now() - t0;
      if (aiResult.summaries && Array.isArray(aiResult.summaries)) {
        summary = aiResult.summaries.map((s: any) => s.summary).join('\n');
      }
      suggestions = parseSuggestions(aiResult.suggestions);
      logger.info('[日报AI内容]', { dayId, summary, suggestions });
    } else {
      throw new Error('AI服务不支持 generateDailyReport 接口');
    }
  } catch (err: any) {
    errorMsg = err && err.message ? err.message : String(err);
    throw new Error(errorMsg);
  }
  // 新增：写入 aiServiceLabel 和 duration 字段
  const report = { stats, summary, suggestions, aiServiceLabel, duration };
  const data = { dayId, report };
  await storage.set(key, data);
  logger.info(`[简化报告] 已生成并缓存 ${dayId} 的报告`, data);
  // 新增：生成后主动通知侧边栏刷新洞察卡片
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: 'ai' } });
  }
  return data;
}

// 获取日报生成状态（供前端轮询）
export function getReportStatus(dayId: string) {
  return reportStatusMap[dayId] || { status: 'none' };
}

// 兼容 AI suggestions 字段为 string/object/object[]/json 字符串的情况，始终返回 string[]
function parseSuggestions(suggestionsRaw: any): string[] {
  let suggestions = suggestionsRaw;
  if (Array.isArray(suggestions) && suggestions.length === 1 && typeof suggestions[0] === 'string') {
    try {
      const parsed = JSON.parse(suggestions[0]);
      if (Array.isArray(parsed)) {
        suggestions = parsed;
      } else if (typeof parsed === 'object' && parsed.summary) {
        suggestions = [parsed.summary];
      } else if (typeof parsed === 'object') {
        suggestions = Object.values(parsed).map(String);
      }
    } catch {}
  } else if (!Array.isArray(suggestions) && typeof suggestions === 'string') {
    try {
      const parsed = JSON.parse(suggestions);
      if (Array.isArray(parsed)) {
        suggestions = parsed;
      } else if (typeof parsed === 'object' && parsed.summary) {
        suggestions = [parsed.summary];
      } else if (typeof parsed === 'object') {
        suggestions = Object.values(parsed).map(String);
      }
    } catch {}
  } else if (Array.isArray(suggestions) && suggestions.length && typeof (suggestions[0] as any) === 'object') {
    // 兼容 suggestions 为对象数组
    suggestions = (suggestions as any[]).map(s => typeof s === 'object' && s.summary ? s.summary : JSON.stringify(s));
  }
  if (!Array.isArray(suggestions)) return [];
  return suggestions.map(String);
}

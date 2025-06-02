// src/background/event-handlers.ts
// 统一管理 background 的所有消息和事件监听
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { config } from '../lib/config/index.js';
import {
  updateIcon,
  onProcessingStart,
  onProcessingEnd,
  setTip,
  setReport,
  setError,
  clearAllIconStatus
} from './icon-state.js';
import {
  handlePageVisitRecord,
  updateVisitAiResult,
  getVisitsByDay,
  getSimpleReport,
  generateSimpleReport
} from './visit-ai.js';

import { AIManager } from '../lib/artificial-intelligence/ai-manager.js';
import { Logger } from '../lib/logger/logger.js';
import { _, _Error } from '../lib/i18n/i18n.js';

const logger = new Logger('background/event-handlers');

// ====== 侧面板相关状态管理 ======
let useSidePanel = false;

// 初始化时从 storage 读取
storage.get<boolean>('useSidePanel').then(val => {
  useSidePanel = !!val;
});


// ========== 扩展图标点击行为优化 ==========
if (chrome && chrome.action && chrome.sidePanel) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (useSidePanel && typeof (chrome.sidePanel as any).getOptions === 'function') {
      try {
        const options = await (chrome.sidePanel as any).getOptions({ tabId: tab.id });
        if (options && options.enabled) {
          // 侧边栏已打开，图标上做提示，不弹窗
          chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
          chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#FFA726' });
          setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 1200);
          return;
        }
      } catch {}
    }
  });
}

// 监听 tab 切换，useSidePanel=true 时自动在新 tab 打开侧面板
if (chrome && chrome.tabs && chrome.sidePanel) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (useSidePanel && typeof (chrome.sidePanel as any).open === 'function') {
      await (chrome.sidePanel as any).open({ tabId });
    }
    // 新增：切换标签页时通知侧边栏滚动到对应卡片
    if (chrome.tabs && chrome.tabs.get) {
      chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.url) {
          chrome.runtime.sendMessage({
            type: 'SCROLL_TO_VISIT',
            payload: { url: tab.url }
          });
        }
      });
    }
  });
}

// ====== messenger 消息处理函数 ======

async function handleMessengerGetVisits(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { dayId: '', visits: [], found: false };
  return await getVisitsByDay(dayId);
}

function handleMessengerGetAiAnalysis(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { analysis: [] };
  const key = `browsing_visits_${dayId}`;
  return storage.get<any[]>(key).then((visits) => ({ analysis: visits || [] }));
}

function handleMessengerDataCleared() {
  return { ok: true };
}

function handleMessengerClearIconStatus() {
  clearAllIconStatus();
  return { ok: true };
}

// ========== 侧面板内容主动刷新机制 ==========
// 侧面板内容刷新：当数据库有新访问记录或AI分析结果时，主动通知侧面板页面刷新
function notifySidePanelUpdate(type: 'visit' | 'ai') {
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: type } });
  }
}

// 包装原有处理函数，任务流重构：访问记录和AI分析合并
async function handlePageVisitRecordWithNotify(record: any, sender?: any, isAnalyze: boolean = true, sourceType?: string) {
  // 1. 写入/更新访问记录（aiResult 为空或'正在进行 AI 分析'，visitCount递增，内容变化/刷新时重置aiResult）
  const result = await handlePageVisitRecord(record);
  // 新增：区分 unload 产生的访问记录日志
  if (sourceType === 'unload') {
    const url = record.url;
    const id = record.id;
    const dayId = record.dayId;
    logger.info('[内容捕获] 页面卸载，更新访问时长和访问次数', { url, dayId, id });
  }
  notifySidePanelUpdate('visit');
  // 2. 只要 mainContent 存在且应分析，自动触发AI分析（兼容 content-script 传 content 字段的情况）
  if (isAnalyze) {
    const mainContent = record.content || record.mainContent;
    if (mainContent && mainContent.length > 0 && (!record.aiResult || record.aiResult === '' || record.aiResult === '正在进行 AI 分析')) {
      await handleMessengerAiAnalyzeRequestWithNotify({
        url: record.url,
        title: record.title,
        content: mainContent,
        id: record.id,
        visitStartTime: record.visitStartTime
      });
    }
  }
  return result;
}

// AI分析只判断aiResult是否为空，若为空则分析，否则直接返回
async function handleMessengerAiAnalyzeRequestWithNotify(msg: any) {
  const { url, title, content, id } = msg.payload || msg;
  const visitStartTime = msg.payload?.visitStartTime || Date.now();
  // dayId 优先
  let dayId = msg.payload?.dayId;
  if (!dayId) {
    const date = new Date(visitStartTime);
    dayId = date.toISOString().slice(0, 10);
  }
  if (!id) {
    logger.warn('ai_analyze_no_visit_record', 'AI 分析请求缺少 id，无法查找访问记录: {0}', url);
    return { ok: false, error: _('ai_analyze_no_visit_record', 'AI 分析请求缺少 id，无法查找访问记录: {0}', url) };
  }
  const visitId = id;
  const key = `browsing_visits_${dayId}`;
  let visits: any[] = (await storage.get<any[]>(key)) || [];
  const visit = visits.find(v => v.id === visitId);

  if (!visit) {
    logger.warn('ai_analyze_no_visit_record', '未找到访问记录: {0}', url);
    return { ok: false, error: _('ai_analyze_no_visit_record', '未找到访问记录: {0}', url) };
  }
  // 只要aiResult为空或'正在进行 AI 分析'，才分析，否则直接返回
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
  onProcessingStart();
  try {
    if (!aiService) throw new _Error('ai_analyze_no_service', '无可用 AI 服务', url);
    logger.info('开始分析: {0}', url);
    const aiSummary = await aiService.summarizePage(url, content);
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    await updateVisitAiResult(url, visitStartTime, aiSummary, analyzeDuration, visitId, aiServiceLabel);
    onProcessingEnd();
    setTip(aiSummary.important);
    notifySidePanelUpdate('ai');
    logger.info('分析完成: {0}', url);
    return { ok: true, aiContent: aiSummary, analyzeDuration, shouldNotify: aiSummary.important };
  } catch (e: any) {
    onProcessingEnd();
    setTip(true);
    logger.error('ai_analyze_error', '分析异常: {0}', url);
    return { ok: false, error: _('ai_analyze_error', '分析异常: {0}', url) };
  }
}

// ====== 汇总报告消息处理 ======
async function handleMessengerGetSummaryReport(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { summary: '' };
  const report = await getSimpleReport(dayId);
  return report || { summary: '' };
}

async function handleMessengerGenerateSummaryReport(msg: any) {
  const dayId = msg.payload?.dayId;
  const force = !!msg.payload?.force;
  if (!dayId) return { summary: '' };
  const report = await generateSimpleReport(dayId, force);
  return report || { summary: '' };
}



// 兜底处理发往侧边栏但侧边栏可能未打开的消息，避免报错
function handleNoop(_msg: any, sender?: chrome.runtime.MessageSender) {
  // sender.url 只在页面上下文存在，background->content script 时可能为 undefined
  if (!sender || !sender.url || !sender.url.includes('sidebar.html')) {
    return { ok: true };
  }
  // 让消息继续传递到侧边栏页面
  return false;
}

async function handleMessengerCheckAiServices() {
  // 只返回检测结果，不广播
  const result = await AIManager.checkAllLocalServicesAvailable();
  return result;
}

function handleMessengerPageVisitAndAnalyze(msg: any, sender?: any) {
  return handlePageVisitRecordWithNotify(msg.payload, sender, true, 'analyze').then(() => {
    notifySidePanelUpdate('visit');
    notifySidePanelUpdate('ai');
    return { ok: true };
  });
}
function handleMessengerUpdatePageVisit(msg: any, sender?: any) {
  return handlePageVisitRecordWithNotify(msg.payload, sender, false, 'unload').then(() => {
    notifySidePanelUpdate('visit');
    return { ok: true };
  });
}

export function registerBackgroundEventHandlers() {
  messenger.on('GET_VISITS', handleMessengerGetVisits);
  messenger.on('GET_AI_ANALYSIS', handleMessengerGetAiAnalysis);
  messenger.on('DATA_CLEARED', handleMessengerDataCleared);
  messenger.on('CLEAR_ICON_STATUS', handleMessengerClearIconStatus);
  messenger.on('GET_SUMMARY_REPORT', handleMessengerGetSummaryReport);
  messenger.on('GENERATE_SUMMARY_REPORT', handleMessengerGenerateSummaryReport);
  messenger.on('SCROLL_TO_VISIT', handleNoop); // 兜底
  messenger.on('SIDE_PANEL_UPDATE', handleNoop); // 兜底
  messenger.on('CHECK_AI_SERVICES', handleMessengerCheckAiServices);

  // 新增：直接用 messenger.on 处理内容脚本发来的 PAGE_VISIT_AND_ANALYZE、PAGE_VISIT_RECORD
  messenger.on('PAGE_VISIT_AND_ANALYZE', handleMessengerPageVisitAndAnalyze);
  messenger.on('UPDATE_PAGE_VISIT', handleMessengerUpdatePageVisit);
}

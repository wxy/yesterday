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
  getSummaryReport,
  generateSummaryReport
} from './visit-ai.js';
import { getActiveAIService } from '../lib/artificial-intelligence/index.js';
import { getCurrentAiConfig } from '../lib/artificial-intelligence/ai-config.js';
import { AIManager } from '../lib/artificial-intelligence/ai-manager.js';
import { Logger } from '../lib/logger/logger.js';
import { _, _Error } from '../lib/i18n/i18n.js';

// ====== 侧面板相关状态管理 ======
let useSidePanel = false;

// 初始化时从 storage 读取
storage.get<boolean>('useSidePanel').then(val => {
  useSidePanel = !!val;
});

function handleGetUseSidePanel() {
  return { useSidePanel };
}

function handleSetUseSidePanel(msg: any) {
  const val = !!(msg.payload?.useSidePanel ?? msg.useSidePanel);
  useSidePanel = val;
  storage.set('useSidePanel', val);
  updateSidePanelMenu(val); // 新增：同步右键菜单勾选状态
  // 切换时自动打开侧面板（仅支持 open，无 close 方法）
  if (chrome && chrome.sidePanel && typeof (chrome.sidePanel as any).open === 'function' && val) {
    (chrome.sidePanel as any).open({ windowId: undefined });
  }
  return { ok: true, useSidePanel: val };
}

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

// ========== 右键菜单：切换侧边栏显示方式 ==========
// 已由 Chrome 原生侧边栏菜单接管，无需自定义 contextMenus 逻辑

// 监听 useSidePanel 状态变化，动态更新菜单勾选
function updateSidePanelMenu(checked: boolean) {
  // 已由 Chrome 原生侧边栏菜单接管，无需自定义
}

// ====== messenger 消息处理函数 ======
async function handleMessengerAiChatRequest(msg: any) {
  const payload = msg.payload || msg;
  try {
    const aiService = await getActiveAIService();
    if (!aiService) throw new Error('无可用 AI 服务');
    // 兼容 chat 风格调用，拼接为 summarizePage
    const userMsg = (payload.messages || []).find((m: any) => m.role === 'user');
    const url = payload.options?.url || '';
    const content = userMsg?.content || '';
    const summary = await aiService.summarizePage(url, content);
    return { success: true, data: summary };
  } catch (err: any) {
    let errorMsg = err?.message || String(err);
    let fullResponse = err?.fullResponse || err?.responseText || '';
    return { success: false, error: errorMsg, fullResponse };
  }
}

function handleMessengerGetStatus() {
  return { status: '正常' };
}

function handleMessengerGetVisits(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { visits: [] };
  const key = `browsing_visits_${dayId}`;
  return storage.get<any[]>(key).then((visits) => ({ visits: visits || [] }));
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
async function handlePageVisitRecordWithNotify(record: any, sender?: any) {
  // 1. 写入/更新访问记录（aiResult 为空或'正在进行 AI 分析'，visitCount递增，内容变化/刷新时重置aiResult）
  const result = await handlePageVisitRecord(record);
  notifySidePanelUpdate('visit');
  // 2. 只要 mainContent 存在且应分析，自动触发AI分析（兼容 content-script 传 content 字段的情况）
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
  return result;
}

// AI分析只判断aiResult是否为空，若为空则分析，否则直接返回
async function handleMessengerAiAnalyzeRequestWithNotify(msg: any) {
  const { url, title, content, id } = msg.payload || msg;
  const visitStartTime = msg.payload?.visitStartTime || Date.now();
  const visitId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (!content) {
    logger.warn('ai_analyze_no_content', '无内容可分析: {0}', url);
    return { ok: false, error: _('ai_analyze_no_content', '无内容可分析: {0}', url) };
  }
  const date = new Date(visitStartTime);
  const dayId = date.toISOString().slice(0, 10);
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
    logger.info('ai_analyze_started', '开始分析: {0}', url);
    const aiSummary = await aiService.summarizePage(url, content);
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    await updateVisitAiResult(url, visitStartTime, aiSummary, analyzeDuration, visitId, aiServiceLabel);
    onProcessingEnd();
    setTip(aiSummary.important);
    notifySidePanelUpdate('ai');
    logger.info('ai_analyze_completed', '分析完成: {0}', url);
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
  const report = await getSummaryReport(dayId);
  return report || { summary: '' };
}

async function handleMessengerGenerateSummaryReport(msg: any) {
  const dayId = msg.payload?.dayId;
  const force = !!msg.payload?.force;
  if (!dayId) return { summary: '' };
  const report = await generateSummaryReport(dayId, force);
  return report || { summary: '' };
}

const logger = new Logger('background/event-handlers');

// 兜底处理发往侧边栏但侧边栏可能未打开的消息，避免报错
function handleNoop(_msg: any, sender?: chrome.runtime.MessageSender) {
  // sender.url 只在页面上下文存在，background->content script 时可能为 undefined
  if (!sender || !sender.url || !sender.url.includes('sidebar.html')) {
    return { ok: true };
  }
  // 让消息继续传递到侧边栏页面
  return false;
}

export function registerBackgroundEventHandlers() {
  // 移除图标点击事件的清除逻辑，彻底只允许通过消息清除
  // chrome.action.onClicked.addListener(() => {
  //   clearAllIconStatus();
  // });

  // 统一 messenger 消息类型为大写，结构更清晰
  messenger.on('AI_CHAT_REQUEST', handleMessengerAiChatRequest);
  messenger.on('AI_ANALYZE_REQUEST', handleMessengerAiAnalyzeRequestWithNotify);
  messenger.on('GET_STATUS', handleMessengerGetStatus);
  messenger.on('GET_VISITS', handleMessengerGetVisits);
  messenger.on('GET_AI_ANALYSIS', handleMessengerGetAiAnalysis);
  messenger.on('DATA_CLEARED', handleMessengerDataCleared);
  messenger.on('CLEAR_ICON_STATUS', handleMessengerClearIconStatus);
  messenger.on('GET_USE_SIDE_PANEL', handleGetUseSidePanel);
  messenger.on('SET_USE_SIDE_PANEL', handleSetUseSidePanel);
  messenger.on('PAGE_VISIT_RECORD', handlePageVisitRecordWithNotify);
  messenger.on('GET_SUMMARY_REPORT', handleMessengerGetSummaryReport);
  messenger.on('GENERATE_SUMMARY_REPORT', handleMessengerGenerateSummaryReport);
  messenger.on('SCROLL_TO_VISIT', handleNoop); // 兜底
  messenger.on('SIDE_PANEL_UPDATE', handleNoop); // 兜底
  messenger.on('PAGE_VISIT_AND_ANALYZE', handlePageVisitRecordWithNotify); // 注册 PAGE_VISIT_AND_ANALYZE 到 messenger，保证所有消息通路一致

  // ========== 消息注册 ========== //
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'PAGE_VISIT_AND_ANALYZE') {
      (async () => {
        try {
          // 1. 先写入访问记录（含主内容、AI分析中标记等）
          await handlePageVisitRecordWithNotify(msg.payload, sender); // 必须用 handlePageVisitRecordWithNotify
          // 2. 通知侧边栏刷新
          notifySidePanelUpdate('visit');
          notifySidePanelUpdate('ai');
          sendResponse && sendResponse({ ok: true });
        } catch (e) {
          sendResponse && sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true; // 异步响应
    }
  });
}

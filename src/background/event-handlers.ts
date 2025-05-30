// src/background/event-handlers.ts
// 统一管理 background 的所有消息和事件监听
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { i18n } from '../lib/i18n/i18n.js';
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
    // 侧边栏未打开，模拟原生弹窗行为（而不是 chrome.windows.create）
    // 通过设置 default_popup 并移除 chrome.windows.create
    // 这里什么都不做，交由 manifest 的 default_popup 控制
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
  const key = `visits_${dayId}`;
  return storage.get<any[]>(key).then((visits) => ({ visits: visits || [] }));
}

function handleMessengerGetAiAnalysis(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { analysis: [] };
  const key = `visits_${dayId}`;
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

// 包装原有处理函数，类型安全
async function handlePageVisitRecordWithNotify(record: any, sender?: any) {
  // 兼容 messenger.on 直接调用和手动调用
  let isRefresh = false;
  if (sender && typeof sender === 'object' && sender.extra && sender.extra.isRefresh) {
    isRefresh = true;
  } else if (record && typeof record === 'object' && record.isRefresh) {
    isRefresh = true;
  }
  if (typeof record === 'object') record.isRefresh = isRefresh;
  const result = await handlePageVisitRecord(record);
  // --- 修复 begin ---
  // 强制刷新场景下将 isRefresh 字段写入 visit 记录并持久化
  if (isRefresh && record.id && record.visitStartTime) {
    const date = new Date(record.visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    let visits: any[] = (await storage.get<any[]>(key)) || [];
    const idx = visits.findIndex(v => v.id === record.id);
    if (idx !== -1) {
      visits[idx].isRefresh = true;
      await storage.set(key, visits);
      console.log('[VISIT] 刷新场景已持久化 isRefresh 字段', { id: record.id, dayId });
      // 关键：强制同步 record.isRefresh，确保后续分析分支判断正确
      record.isRefresh = true;
    }
  }
  // --- 修复 end ---
  notifySidePanelUpdate('visit');
  // 新增：只要 aiResult 被清空（刷新或内容变化），都自动触发 AI 分析
  const shouldAnalyze = (result.status === 'new' || result.status === 'refresh') || (typeof record.aiResult === 'string' && record.aiResult === '');
  if (shouldAnalyze) {
    if (record.mainContent && record.mainContent.length > 0) {
      await handleMessengerAiAnalyzeRequestWithNotify({
        url: record.url,
        title: record.title,
        content: record.mainContent,
        id: record.id,
        visitStartTime: record.visitStartTime
      });
    }
  }
  return result;
}
async function handleMessengerAiAnalyzeRequestWithNotify(msg: any) {
  // 兼容 content/popup 侧发起的 AI_ANALYZE_REQUEST
  const { url, title, content, id } = msg.payload || msg;
  const visitStartTime = msg.payload?.visitStartTime || Date.now();
  const visitId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (!content) {
    console.warn('[AI_ANALYZE] 拒绝分析：无内容', { url, visitId, visitStartTime });
    return { ok: false, error: 'No content' };
  }
  // 检查访问记录是否存在，不存在则直接返回错误，不再自动补充
  const date = new Date(visitStartTime);
  const dayId = date.toISOString().slice(0, 10);
  const key = `visits_${dayId}`;
  let visits: any[] = (await storage.get<any[]>(key)) || [];
  const visit = visits.find(v => v.id === visitId);
  if (!visit) {
    console.error('[AI_ANALYZE] 未找到访问记录', { url, visitId, visitStartTime, key, visitsLength: visits.length });
    return { ok: false, error: 'No visit record found for AI analysis' };
  }
  // 判断是否为刷新/重复访问
  const isRefresh = !!visit.isRefresh;
  const isRepeat = !isRefresh && (visit.visitCount && visit.visitCount > 1);
  console.log('[AI_ANALYZE] 入口', {
    url,
    visitId,
    visitStartTime,
    contentLength: content.length,
    isRefresh,
    isRepeat,
    visitCount: visit.visitCount,
    aiResult: visit.aiResult,
    title,
    dayId,
    key
  });
  if (isRepeat) {
    console.log('[AI_ANALYZE] 跳过重复分析', { url, visitId, visitCount: visit.visitCount });
    // 非刷新且为重复访问，不再分析
    return { ok: true, skipped: true, reason: 'repeat' };
  }
  // 分析前强制reload配置，确保读取数据库最新AI配置
  await config.reload();
  const allConfig: any = await config.getAll();
  const aiConfig = allConfig && allConfig['aiServiceConfig'] ? allConfig['aiServiceConfig'] : { serviceId: 'ollama' };
  const aiService = await AIManager.instance.getAvailableService(aiConfig.serviceId);
  // 获取 AI 服务标签
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
    if (!aiService) throw new Error('无可用 AI 服务');
    console.log('[AI_ANALYZE] 开始分析', { url, visitId, aiServiceLabel, contentLength: content.length });
    const aiSummary = await aiService.summarizePage(url, content);
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    await updateVisitAiResult(url, visitStartTime, aiSummary, analyzeDuration, visitId, aiServiceLabel); // 传递 aiServiceLabel
    onProcessingEnd();
    setTip(aiSummary.important);
    notifySidePanelUpdate('ai');
    console.log('[AI_ANALYZE] 分析完成', { url, visitId, analyzeDuration, aiSummary });
    return { ok: true, aiContent: aiSummary, analyzeDuration, shouldNotify: aiSummary.important };
  } catch (e: any) {
    onProcessingEnd();
    setTip(true);
    console.error('[AI_ANALYZE] 分析异常', { url, visitId, error: e?.message || String(e) });
    return { ok: false, error: e?.message || String(e) };
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
}

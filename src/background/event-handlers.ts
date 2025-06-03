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
  generateSimpleReport,
  handlePageVisitAndMaybeAnalyze,
  analyzeVisitRecordById
} from './visit-ai.js';

import { AIManager } from '../lib/artificial-intelligence/ai-manager.js';
import { Logger } from '../lib/logger/logger.js';
import { _, _Error } from '../lib/i18n/i18n.js';

const logger = new Logger('background/event-handlers');

if (chrome && chrome.tabs && chrome.sidePanel) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    // 切换标签页时通知侧边栏滚动到对应卡片
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
  if (!dayId) return { visits: [] };
  const key = `browsing_visits_${dayId}`;
  return storage.get<any[]>(key).then((visits) => ({ visits: visits || [] }));
}

function handleMessengerDataCleared() {
  return { ok: true };
}

function handleMessengerClearIconStatus() {
  clearAllIconStatus();
  return { ok: true };
}

// ====== 统一 glue 层方法注释与参数说明 ======

/**
 * 访问记录与 AI 分析主入口（glue 层，仅做参数校验和转发，始终触发分析）
 * @param msg 消息体，需包含页面访问相关字段
 * @param sender 消息发送方
 * @returns 处理结果
 */
async function handlePageVisit(msg: any, sender?: any) {
  if (!msg || typeof msg !== 'object') return { status: 'invalid' };
  // 始终触发 AI 分析
  const result = await handlePageVisitAndMaybeAnalyze(msg, { isAnalyze: true });
  return result;
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

function handleUpdatePageVisit(msg: any, sender?: any) {
  // 只处理页面卸载/停留时长更新，不触发AI分析
  return handlePageVisitAndMaybeAnalyze(msg, { isAnalyze: false, sourceType: 'unload' });
}

// 注册消息时同步更名
export function registerBackgroundEventHandlers() {
  messenger.on('GET_VISITS', handleMessengerGetVisits);
  messenger.on('DATA_CLEARED', handleMessengerDataCleared);
  messenger.on('CLEAR_ICON_STATUS', handleMessengerClearIconStatus);
  messenger.on('GET_SUMMARY_REPORT', handleMessengerGetSummaryReport);
  messenger.on('GENERATE_SUMMARY_REPORT', handleMessengerGenerateSummaryReport);
  messenger.on('SCROLL_TO_VISIT', handleNoop); // 兜底
  messenger.on('SIDE_PANEL_UPDATE', handleNoop); // 兜底
  messenger.on('CHECK_AI_SERVICES', handleMessengerCheckAiServices);
  messenger.on('PAGE_VISIT_AND_ANALYZE', handlePageVisit);
  messenger.on('UPDATE_PAGE_VISIT', handleUpdatePageVisit);
}



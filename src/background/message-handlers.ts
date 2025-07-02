// src/background/message-handlers.ts
// 统一管理 background 的所有 messenger 消息监听
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { getReportStatus, queueGenerateSimpleReport, getSimpleReport, handlePageVisitAndMaybeAnalyze, reanalyzeVisitById } from './visit-ai.js';
import { AIManager } from '../lib/ai/ai-manager.js';
import { clearAllIconStatus } from './icon-state.js';

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

function handleMessengerGetReportStatus(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { status: 'none' };
  return getReportStatus(dayId);
}

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
  // 改为队列化，支持结构化状态反馈
  const report = await queueGenerateSimpleReport(dayId, force);
  return report || { summary: '' };
}

function handleNoop(_msg: any, sender?: chrome.runtime.MessageSender) {
  if (!sender || !sender.url || !sender.url.includes('sidebar.html')) {
    return { ok: true };
  }
  return false;
}

async function handleMessengerCheckAiServices() {
  const result = await AIManager.checkAllLocalServicesAvailable();
  return result;
}

function handleUpdatePageVisit(msg: any, sender?: any) {
  return handlePageVisitAndMaybeAnalyze(msg, { isAnalyze: false, sourceType: 'unload' });
}

async function handlePageVisit(msg: any, sender?: any) {
  if (!msg || typeof msg !== 'object') return { status: 'invalid' };
  const result = await handlePageVisitAndMaybeAnalyze(msg, { isAnalyze: true });
  return result;
}

async function handleMessengerReanalyzeVisit(msg: any) {
  if (!msg || typeof msg !== 'object' || !msg.payload || !msg.payload.id) return { status: 'invalid' };
  return await reanalyzeVisitById(msg.payload.id);
}

export function registerMessageHandlers() {
  messenger.on('GET_VISITS', 
    handleMessengerGetVisits);
  messenger.on('DATA_CLEARED', 
    handleMessengerDataCleared);
  messenger.on('CLEAR_ICON_STATUS', 
    handleMessengerClearIconStatus);
  messenger.on('GET_SUMMARY_REPORT', 
    handleMessengerGetSummaryReport);
  messenger.on('GENERATE_SUMMARY_REPORT', 
    handleMessengerGenerateSummaryReport);
  messenger.on('GET_REPORT_STATUS', 
    handleMessengerGetReportStatus);
  messenger.on('SCROLL_TO_VISIT', 
    handleNoop);
  messenger.on('SIDE_PANEL_UPDATE', 
    handleNoop);
  messenger.on('CHECK_AI_SERVICES', 
    handleMessengerCheckAiServices);
  messenger.on('PAGE_VISIT_AND_ANALYZE', 
    handlePageVisit);
  messenger.on('UPDATE_PAGE_VISIT', 
    handleUpdatePageVisit);
  messenger.on('REANALYZE_VISIT', 
    handleMessengerReanalyzeVisit);
}

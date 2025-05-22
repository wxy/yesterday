// src/background/event-handlers.ts
// 统一管理 background 的所有消息和事件监听
import { chat, AiChatResponse } from '../lib/ai/ai.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
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
  getVisitsByDay
} from './visit-ai.js';

// ====== messenger 消息处理函数 ======
function handleMessengerAiChatRequest(msg: any) {
  const payload = msg.payload || msg;
  return chat(payload.messages, payload.options || {})
    .then((resp: AiChatResponse) => ({ success: true, data: resp }))
    .catch((err: any) => {
      let errorMsg = '';
      let fullResponse = '';
      if (err && typeof err === 'object') {
        errorMsg = (err as any).message || String(err);
        fullResponse = (err as any).fullResponse || (err as any).responseText || '';
      } else {
        errorMsg = String(err);
      }
      return { success: false, error: errorMsg, fullResponse };
    });
}

function handleMessengerAiAnalyzeRequest(msg: any) {
  // 兼容 content/popup 侧发起的 AI_ANALYZE_REQUEST
  const { url, title, content } = msg.payload || msg;
  if (!content) return { ok: false, error: 'No content' };
  const visitStartTime = Date.now();
  const visitRecord = {
    url,
    title,
    mainContent: content,
    visitStartTime,
    aiResult: '正在进行 AI 分析',
  };
  handlePageVisitRecord(visitRecord);
  const analyzeStart = Date.now();
  onProcessingStart();
  return chat([
    { role: 'system', content: '请对以下网页内容进行简要总结和主题提取。' },
    { role: 'user', content }
  ]).then((data: AiChatResponse) => {
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    updateVisitAiResult(url, visitStartTime, typeof data === 'string' ? data : data.text, analyzeDuration);
    const aiResult = {
      url,
      title,
      aiResult: data.text || data,
      timestamp: Date.now(),
      analyzeDuration,
    };
    const dayId = new Date().toISOString().slice(0, 10);
    const key = `ai_analysis_${dayId}`;
    return storage.get<any[]>(key).then((list) => {
      const arr = Array.isArray(list) ? list : [];
      arr.push(aiResult);
      return storage.set(key, arr).then(() => {
        onProcessingEnd();
        setTip(true);
        return { ok: true, aiContent: aiResult.aiResult, response: data, analyzeDuration };
      });
    });
  }).catch((e: any) => {
    updateVisitAiResult(url, visitStartTime, `AI 分析失败：${e?.message || e}`, 0);
    onProcessingEnd();
    setTip(true);
    return { ok: false, error: e?.message || e };
  });
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

function handleMessengerPageAiAnalysis(msg: any) {
  const { url, title, aiResult, timestamp } = msg.payload || msg;
  if (!url || !aiResult) return { success: false };
  const dayId = new Date(timestamp || Date.now()).toISOString().slice(0, 10);
  const key = `ai_analysis_${dayId}`;
  return storage.get<any[]>(key).then((list) => {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.some(item => item.url === url && item.timestamp === timestamp)) {
      arr.push({ url, title, aiResult, timestamp });
      return storage.set(key, arr).then(() => ({ success: true }));
    } else {
      return { success: true, skipped: true };
    }
  });
}

function handleMessengerGetAiAnalysis(msg: any) {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { analysis: [] };
  const key = `ai_analysis_${dayId}`;
  return storage.get<any[]>(key).then((analysis) => ({ analysis: analysis || [] }));
}

function handleMessengerDataCleared() {
  return { ok: true };
}

function handleMessengerClearIconStatus() {
  clearAllIconStatus();
  return { ok: true };
}

export function registerBackgroundEventHandlers() {
  // 移除图标点击事件的清除逻辑，彻底只允许通过消息清除
  // chrome.action.onClicked.addListener(() => {
  //   clearAllIconStatus();
  // });

  // 统一 messenger 消息类型为大写，结构更清晰
  messenger.on('AI_CHAT_REQUEST', handleMessengerAiChatRequest);
  messenger.on('AI_ANALYZE_REQUEST', handleMessengerAiAnalyzeRequest);
  messenger.on('GET_STATUS', handleMessengerGetStatus);
  messenger.on('GET_VISITS', handleMessengerGetVisits);
  messenger.on('PAGE_AI_ANALYSIS', handleMessengerPageAiAnalysis);
  messenger.on('GET_AI_ANALYSIS', handleMessengerGetAiAnalysis);
  messenger.on('DATA_CLEARED', handleMessengerDataCleared);
  messenger.on('CLEAR_ICON_STATUS', handleMessengerClearIconStatus);
}

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

function handleGetVisits(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  const dayId = message.dayId || (message.payload && message.payload.dayId);
  getVisitsByDay(dayId).then(data => {
    sendResponse({ visits: data });
  }).catch(err => {
    sendResponse({ visits: [], error: err?.message || String(err) });
  });
  return true;
}

function handlePageVisitRecordMsg(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  const data = message.data || message.payload;
  handlePageVisitRecord(data);
}

function handleAiChatRequest(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  const payload = message.payload || message;
  chat(payload.messages, payload.options || {})
    .then((resp: any) => {
      sendResponse({ success: true, data: resp });
    })
    .catch((err: any) => {
      sendResponse({ success: false, error: err?.message || String(err), fullResponse: err?.fullResponse || err?.responseText });
    });
  return true;
}

function handleAiAnalyzeRequest(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  if (!message.content) return;
  const visitStartTime = Date.now();
  const visitRecord = {
    url: message.url,
    title: message.title,
    mainContent: message.content,
    visitStartTime,
    from: sender?.tab?.url || undefined,
    aiResult: '正在进行 AI 分析',
  };
  handlePageVisitRecord(visitRecord);
  const analyzeStart = Date.now();
  onProcessingStart();
  chat([
    { role: 'system', content: '请对以下网页内容进行简要总结和主题提取。' },
    { role: 'user', content: message.content }
  ]).then((data: AiChatResponse) => {
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    const aiResult = {
      url: message.url,
      title: message.title,
      aiResult: data.text || data,
      timestamp: Date.now(),
      analyzeDuration,
    };
    updateVisitAiResult(message.url, visitStartTime, typeof data === 'string' ? data : data.text, analyzeDuration);
    const dayId = new Date().toISOString().slice(0, 10);
    const key = `ai_analysis_${dayId}`;
    storage.get<any[]>(key).then((list) => {
      const arr = Array.isArray(list) ? list : [];
      arr.push(aiResult);
      storage.set(key, arr);
    });
    sendResponse({ ok: true, aiContent: aiResult.aiResult, response: data, analyzeDuration });
    onProcessingEnd();
    setTip(true);
  })
  .catch((e: any) => {
    updateVisitAiResult(message.url, visitStartTime, `AI 分析失败：${e?.message || e}`, 0);
    sendResponse({ ok: false, error: e?.message || e });
    onProcessingEnd();
    setTip(true);
  });
  return true;
}

function handleClearIconStatus(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  clearAllIconStatus();
  sendResponse && sendResponse({ ok: true });
}

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

export function registerBackgroundEventHandlers() {
  // 消息类型分流映射
  const onMessageHandlers: Record<string, (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => boolean | void> = {
    'PAGE_VISIT_RECORD': handlePageVisitRecordMsg,
    'GET_VISITS': handleGetVisits,
    'AI_CHAT_REQUEST': handleAiChatRequest,
    'AI_ANALYZE_REQUEST': handleAiAnalyzeRequest,
    'CLEAR_ICON_STATUS': handleClearIconStatus
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = (message && message.type) ? String(message.type).toUpperCase() : '';
    if (onMessageHandlers[type]) {
      return onMessageHandlers[type](message, sender, sendResponse);
    }
  });

  // 图标点击事件
  chrome.action.onClicked.addListener(() => {
    clearAllIconStatus();
  });

  // 统一 messenger 消息类型为大写，结构更清晰
  const messengerHandlers: Record<string, Function> = {
    'AI_CHAT_REQUEST': handleMessengerAiChatRequest,
    'GET_STATUS': handleMessengerGetStatus,
    'GET_VISITS': handleMessengerGetVisits,
    'PAGE_AI_ANALYSIS': handleMessengerPageAiAnalysis,
    'GET_AI_ANALYSIS': handleMessengerGetAiAnalysis,
    'DATA_CLEARED': handleMessengerDataCleared
  };

  messenger.on('AI_CHAT_REQUEST', (msg, sender) => messengerHandlers['AI_CHAT_REQUEST'](msg, sender));
  messenger.on('GET_STATUS', (msg, sender) => messengerHandlers['GET_STATUS'](msg, sender));
  messenger.on('GET_VISITS', (msg, sender) => messengerHandlers['GET_VISITS'](msg, sender));
  messenger.on('PAGE_AI_ANALYSIS', (msg, sender) => messengerHandlers['PAGE_AI_ANALYSIS'](msg, sender));
  messenger.on('GET_AI_ANALYSIS', (msg, sender) => messengerHandlers['GET_AI_ANALYSIS'](msg, sender));
  messenger.on('DATA_CLEARED', (msg, sender) => messengerHandlers['DATA_CLEARED'](msg, sender));
}

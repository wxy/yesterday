// src/background/event-handlers.ts
// 统一管理 background 的所有消息和事件监听
import { chat, AiChatResponse } from '../lib/ai/ai.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { i18n } from '../lib/i18n/i18n.js';
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
  // 获取当前扩展语言
  let lang = 'zh';
  try {
    lang = typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function'
      ? chrome.i18n.getUILanguage()
      : 'zh';
  } catch {}
  // 多语言结构化 prompt
  const promptMap: Record<string, string> = {
    zh: `你将分析如下网页内容，请用中文输出结构化 JSON 格式：\n{\n  summary: "...",\n  highlights: "..." 或 [...],\n  points: ["...", "..."],\n  suggestion: "...",\n  shouldNotify: true/false\n}\n如无法结构化输出，可降级为分条文本，但结尾请加一行“【是否建议提示用户】：是/否”。`,
    en: `Analyze the following web content and output a structured JSON in English:\n{\n  summary: "...",\n  highlights: "..." or [...],\n  points: ["...", "..."],\n  suggestion: "...",\n  shouldNotify: true/false\n}\nIf you cannot output structured JSON, use bullet points in English and end with a line: [Should notify user]: Yes/No.`,
    // 可扩展更多语言
  };
  const systemPrompt = promptMap[lang] || promptMap['zh'];
  // 支持元信息
  const meta = { url, title, fetchTime: new Date(visitStartTime).toLocaleString(), lang };
  return chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content }
  ], { meta }).then((data: AiChatResponse) => {
    const analyzeEnd = Date.now();
    const analyzeDuration = analyzeEnd - analyzeStart;
    let aiText = typeof data === 'string' ? data : data.text;
    let shouldNotify = false;
    let aiJson: any = null;
    // 尝试解析结构化 JSON
    if (aiText) {
      try {
        // 只提取第一个 {...} 结构
        const match = aiText.match(/\{[\s\S]*\}/);
        if (match) {
          aiJson = JSON.parse(match[0]);
          if (typeof aiJson.shouldNotify === 'boolean') {
            shouldNotify = aiJson.shouldNotify;
          } else if (typeof aiJson.suggestion === 'string' && /建议|关注|重要|警告/.test(aiJson.suggestion)) {
            shouldNotify = true;
          }
        }
      } catch {}
      // 降级：若无法结构化，继续用原有正则判断
      if (aiJson === null) {
        // 1. AI 明确建议
        if (/【是否建议提示用户】\s*[:：]\s*是/.test(aiText)) {
          shouldNotify = true;
        }
        // 2. 关键词辅助
        else if (/强烈建议|必须注意|风险|警告|重点|重要|建议关注|值得关注/.test(aiText)) {
          shouldNotify = true;
        }
        // 3. AI 明确否定
        else if (/【是否建议提示用户】\s*[:：]\s*否|无特别建议|暂无特别建议/.test(aiText)) {
          shouldNotify = false;
        }
      }
    }
    updateVisitAiResult(url, visitStartTime, aiText, analyzeDuration);
    const aiResult = {
      url,
      title,
      aiResult: aiText,
      aiJson,
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
        setTip(shouldNotify);
        return { ok: true, aiContent: aiResult.aiResult, aiJson, response: data, analyzeDuration, shouldNotify };
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

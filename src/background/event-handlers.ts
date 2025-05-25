// src/background/event-handlers.ts
// 统一管理 background 的所有消息和事件监听
import { chat, AiChatResponse } from '../lib/ai/ai.js';
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
  getVisitsByDay
} from './visit-ai.js';

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
  });
}

// ========== 右键菜单：切换侧边栏显示方式 ==========
// 已由 Chrome 原生侧边栏菜单接管，无需自定义 contextMenus 逻辑

// 监听 useSidePanel 状态变化，动态更新菜单勾选
function updateSidePanelMenu(checked: boolean) {
  // 已由 Chrome 原生侧边栏菜单接管，无需自定义
}

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

async function handleMessengerAiAnalyzeRequest(msg: any) {
  // 兼容 content/popup 侧发起的 AI_ANALYZE_REQUEST
  const { url, title, content, id } = msg.payload || msg;
  // 优先使用 payload 里的 visitStartTime，保证分析与访问记录一一对应
  const visitStartTime = msg.payload?.visitStartTime || Date.now();
  // 主键 id，优先用 payload 传递，没有则生成
  const visitId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (!content) return { ok: false, error: 'No content' };
  const visitRecord = {
    id: visitId,
    url,
    title,
    mainContent: content,
    visitStartTime,
    aiResult: '正在进行 AI 分析',
  };
  handlePageVisitRecordWithNotify(visitRecord);
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
  const meta = { id: visitId, url, title, fetchTime: new Date(visitStartTime).toLocaleString(), lang };
  // 读取全局 AI 分析超时配置（毫秒）
  let timeoutMs = 60000;
  try {
    const cfg = await config.get('advanced.requestTimeout');
    if (typeof cfg === 'number' && !isNaN(cfg) && cfg >= 1000) {
      timeoutMs = cfg;
    } else {
      console.warn('[AI分析] 配置超时值异常，已回退默认 60000ms，实际值:', cfg);
    }
  } catch (e) {
    console.warn('[AI分析] 读取超时配置异常，已回退默认 60000ms', e);
  }
  console.log('[AI分析] 调用 chat，timeoutMs =', timeoutMs);
  return chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content }
  ], { meta, timeoutMs }) // 统一传递配置超时
    .then((data: AiChatResponse) => {
      const analyzeEnd = Date.now();
      const analyzeDuration = analyzeEnd - analyzeStart;
      let aiText = typeof data === 'string' ? data : data.text;
      if (!aiText || aiText.trim() === '') {
        aiText = 'AI 分析失败或无结果';
      }
      let shouldNotify = false;
      let aiJson: any = null;
      // 尝试解析结构化 JSON
      let match: RegExpMatchArray | null = null;
      if (aiText) {
        // 补充：无论是否进入 try-catch，先输出正则匹配结果和原始文本
        console.log('[AI分析] JSON 匹配前', { aiText });
        match = aiText.match(/\{[\s\S]*\}/);
        console.log('[AI分析] JSON 匹配结果', { match, aiText });
        try {
          // 只提取第一个 {...} 结构
          if (match) {
            aiJson = JSON.parse(match[0]);
            if (typeof aiJson.shouldNotify === 'boolean') {
              shouldNotify = aiJson.shouldNotify;
            } else if (typeof aiJson.suggestion === 'string' && /建议|关注|重要|警告/.test(aiJson.suggestion)) {
              shouldNotify = true;
            }
          }
        } catch (e) {
          // 增强日志，输出详细异常、原始片段和完整 aiText
          console.error('[AI分析] 结构化 JSON 解析失败', {
            error: e,
            stack: (e instanceof Error ? e.stack : undefined),
            match: match && match[0],
            aiText,
            charCodes: match && match[0] ? Array.from(match[0]).map(c => c.charCodeAt(0)) : undefined
          });
        }
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
      updateVisitAiResult(url, visitStartTime, aiText, analyzeDuration, visitId);
      const aiResult = {
        id: visitId,
        url,
        title,
        visitStartTime, // 保证唯一性
        aiResult: aiText,
        aiJson,
        timestamp: Date.now(),
        analyzeDuration,
      };
      console.log('[AI分析] 即将写入 ai_analysis，aiResult =', aiResult);
      const dayId = new Date().toISOString().slice(0, 10);
      const key = `ai_analysis_${dayId}`;
      return storage.get<any[]>(key).then((list) => {
        const arr = Array.isArray(list) ? list : [];
        arr.push(aiResult);
        return storage.set(key, arr).then(() => {
          onProcessingEnd();
          setTip(shouldNotify);
          notifySidePanelUpdate('ai');
          return { ok: true, aiContent: aiResult.aiResult, aiJson, response: data, analyzeDuration, shouldNotify };
        });
      });
    }).catch((e: any) => {
      console.error('[AI分析] chat 失败', e, e?.fullResponse || e?.raw || e?.responseText || '');
      updateVisitAiResult(url, visitStartTime, `AI 分析失败：${e?.message || e}`, 0, visitId);
      onProcessingEnd();
      setTip(true);
      return { ok: false, error: e?.message || e, fullResponse: e?.fullResponse || e?.raw || e?.responseText || '' };
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

// ========== 侧面板内容主动刷新机制 ==========
// 侧面板内容刷新：当数据库有新访问记录或AI分析结果时，主动通知侧面板页面刷新
function notifySidePanelUpdate(type: 'visit' | 'ai') {
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'SIDE_PANEL_UPDATE', payload: { updateType: type } });
  }
}

// 包装原有处理函数，类型安全
function handlePageVisitRecordWithNotify(record: any) {
  handlePageVisitRecord(record);
  notifySidePanelUpdate('visit');
}
async function handleMessengerAiAnalyzeRequestWithNotify(msg: any) {
  const result = await handleMessengerAiAnalyzeRequest(msg);
  notifySidePanelUpdate('ai');
  return result;
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
  messenger.on('PAGE_AI_ANALYSIS', handleMessengerPageAiAnalysis);
  messenger.on('GET_AI_ANALYSIS', handleMessengerGetAiAnalysis);
  messenger.on('DATA_CLEARED', handleMessengerDataCleared);
  messenger.on('CLEAR_ICON_STATUS', handleMessengerClearIconStatus);
  messenger.on('GET_USE_SIDE_PANEL', handleGetUseSidePanel);
  messenger.on('SET_USE_SIDE_PANEL', handleSetUseSidePanel);
  messenger.on('PAGE_VISIT_RECORD', handlePageVisitRecordWithNotify);
}

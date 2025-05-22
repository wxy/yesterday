/**
 * Chrome 扩展后台脚本
 * 
 * 此脚本负责初始化各个子系统和提供基本的扩展生命周期处理
 */

// 导入核心模块
import { Logger } from '../lib/logger/logger.js';
import { storage } from '../lib/storage/index.js';
import { i18n } from '../lib/i18n/i18n.js';
import { browserEvents } from '../lib/browser-events/index.js';
import { config } from '../lib/config/index.js';
// 修改消息系统导入方式 - 使用默认导出
import messageBus, { setupMessageHandlers } from '../lib/messaging/index.js';
import { messenger } from '../lib/messaging/messenger.js';
import { chat, AiChatResponse } from '../lib/ai/ai.js'; // 统一入口

// 初始化日志系统（Logger 可能不需要显式初始化，创建实例即可）
const logger = new Logger('background');
logger.info('后台脚本启动');

/**
 * 初始化所有子系统
 */
async function initializeSubsystems() {
  try {
    // 1. 初始化国际化系统
    await i18n.init();
    logger.info('国际化系统已初始化');
    
    // 2. 初始化存储系统 (优先初始化，因为其他系统可能依赖它)
    await storage.init();
    logger.info('存储系统已初始化');
    
    // 3. 初始化配置系统 (依赖存储系统)
    await config.init();
    logger.info('配置系统已初始化');
    
    // 4. 初始化事件管理器
    await browserEvents.init();
    logger.info('浏览器事件系统已初始化');
    
    // 5. 初始化消息系统核心 (显式初始化)
    await messageBus.init();
    logger.info('消息系统已初始化');
    
    // 6. 设置消息处理器 (注册处理函数)
    await setupMessageHandlers();
    logger.info('消息处理器已配置完成');
    
    // 所有系统初始化完成
    logger.info('所有子系统初始化完成');
  } catch (error) {
    logger.error('初始化子系统失败:', error);
  }
}

/**
 * 扩展安装/更新事件处理
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    logger.info('扩展已安装');
    // 记录安装事件
    await storage.set('installDate', new Date().toISOString());
    
  } else if (details.reason === 'update') {
    const previousVersion = details.previousVersion || 'unknown';
    const currentVersion = chrome.runtime.getManifest().version;
    logger.info(`扩展已更新: ${previousVersion} -> ${currentVersion}`);
    
    // 记录更新事件
    const updateHistory = await storage.get<string[]>('updateHistory') || [];
    updateHistory.push(`${previousVersion} -> ${currentVersion} (${new Date().toISOString()})`);
    await storage.set('updateHistory', updateHistory);
  }
});

// 监听 content script 发送的页面访问记录消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'PAGE_VISIT_RECORD' && (message.data || message.payload)) {
    const data = message.data || message.payload;
    logger.info('[内容捕获] 收到访问记录', { url: data.url, from: sender?.tab?.url });
    handlePageVisitRecord(data);
  }
  // 支持 popup 查询访问记录
  if (message && message.type === 'GET_VISITS' && (message.dayId || (message.payload && message.payload.dayId))) {
    // 兼容 payload 结构
    const dayId = message.dayId || (message.payload && message.payload.dayId);
    getVisitsByDay(dayId).then(data => {
      sendResponse({ visits: data });
    }).catch(err => {
      sendResponse({ visits: [], error: err?.message || String(err) });
    });
    return true; // 必须返回true，保持异步通道
  }
  // ===== AI 代理请求处理 =====
  if (message && (message.type === 'AI_CHAT_REQUEST' || (message.payload && message.payload.__aiProxy))) {
    // 兼容 payload 结构
    const payload = message.payload || message;
    chat(payload.messages, payload.options || {})
      .then((resp: any) => {
        sendResponse({ success: true, data: resp });
      })
      .catch((err: any) => {
        sendResponse({ success: false, error: err?.message || String(err), fullResponse: err?.fullResponse || err?.responseText });
      });
    return true; // 异步响应
  }
  // ========== AI_ANALYZE_REQUEST：后台代理本地 AI 分析 ==========
  if (message && message.type === 'AI_ANALYZE_REQUEST' && message.content) {
    // 1. 记录原始访问内容，aiResult 初始为“正在进行 AI 分析”
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
    // 2. 调用统一 AI 接口
    const analyzeStart = Date.now();
    chat([
      { role: 'system', content: '请对以下网页内容进行简要总结和主题提取。' },
      { role: 'user', content: message.content }
    ]).then((data: AiChatResponse) => {
      const analyzeEnd = Date.now();
      const analyzeDuration = analyzeEnd - analyzeStart;
      // 3. 记录 AI 分析结果
      const aiResult = {
        url: message.url,
        title: message.title,
        aiResult: data.text || data,
        timestamp: Date.now(),
        analyzeDuration,
      };
      // 3.1 更新访问记录的 aiResult 字段和 analyzeDuration
      updateVisitAiResult(message.url, visitStartTime, typeof data === 'string' ? data : data.text, analyzeDuration);
      // 3.2 存储分析结果
      const dayId = new Date().toISOString().slice(0, 10);
      const key = `ai_analysis_${dayId}`;
      storage.get<any[]>(key).then((list) => {
        const arr = Array.isArray(list) ? list : [];
        arr.push(aiResult);
        storage.set(key, arr);
      });
      sendResponse({ ok: true, aiContent: aiResult.aiResult, response: data, analyzeDuration });
    })
    .catch((e: any) => {
      logger.error('[AI] fetch 异常', e);
      // 失败时也更新访问记录，便于 UI 反馈
      updateVisitAiResult(message.url, visitStartTime, `AI 分析失败：${e?.message || e}`, 0);
      sendResponse({ ok: false, error: e?.message || e });
    });
    return true; // 异步响应
  }
});

const VISIT_KEEP_DAYS = 7; // 默认保留天数

/**
 * 处理页面访问记录，按日期归档存储
 */
async function handlePageVisitRecord(data: any) {
  try {
    // 以访问起始时间为准，生成 dayId
    const date = new Date(data.visitStartTime);
    const dayId = date.toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `visits_${dayId}`;
    // 读取当天已有记录
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    // 去重：同一 url+visitStartTime 不重复
    if (!visits.some(v => v.url === data.url && v.visitStartTime === data.visitStartTime)) {
      visits.push(data);
      await storage.set(key, visits);
      logger.info(`[内容捕获] 已存储访问记录`, { url: data.url, dayId });
    } else {
      logger.info(`[内容捕获] 跳过重复访问记录`, { url: data.url, dayId });
    }
    // 自动清理过期数据
    await cleanupOldVisits();
  } catch (err) {
    logger.error('存储页面访问记录失败', err);
  }
}

/**
 * 更新访问记录的 aiResult 字段和 analyzeDuration
 */
async function updateVisitAiResult(url: string, visitStartTime: number, aiResult: string, analyzeDuration: number) {
  try {
    const date = new Date(visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let updated = false;
    for (const v of visits) {
      if (v.url === url && v.visitStartTime === visitStartTime) {
        v.aiResult = aiResult;
        v.analyzeDuration = analyzeDuration;
        updated = true;
        break;
      }
    }
    if (updated) {
      await storage.set(key, visits);
      logger.info(`[AI] 已更新访问记录的 aiResult`, { url, dayId });
    }
  } catch (err) {
    logger.error('更新访问记录 aiResult 失败', err);
  }
}

// UI 展示 analyzeDuration 时建议：`${(analyzeDuration/1000).toFixed(1)} 秒`，分析失败为 0。

/**
 * 获取指定日期的访问记录
 */
async function getVisitsByDay(dayId: string) {
  const key = `visits_${dayId}`;
  return (await storage.get<any[]>(key)) || [];
}

/**
 * 清理过期访问数据，只保留最近 VISIT_KEEP_DAYS 天
 */
async function cleanupOldVisits() {
  try {
    const allKeys: string[] = await storage.keys();
    const visitKeys = allKeys.filter(k => k.startsWith('visits_'));
    // 提取所有日期
    const days = visitKeys.map(k => k.replace('visits_', ''));
    // 按日期排序，保留最新 N 天
    const sortedDays = days.sort().reverse();
    const keepDays = sortedDays.slice(0, VISIT_KEEP_DAYS);
    const removeDays = sortedDays.slice(VISIT_KEEP_DAYS);
    for (const day of removeDays) {
      await storage.remove(`visits_${day}`);
      logger.info(`[内容捕获] 已清理过期访问数据`, { day });
    }
  } catch (err) {
    logger.error('清理过期访问数据失败', err);
  }
}

// 注册 AI_CHAT_REQUEST handler，支持 messenger.send
messenger.on('AI_CHAT_REQUEST', async (msg) => {
  console.log('[BG] AI_CHAT_REQUEST handler called', msg);
  const payload = msg.payload || msg;
  try {
    console.log('[BG] 调用 chat 前', payload);
    const resp: AiChatResponse = await chat(payload.messages, payload.options || {});
    console.log('[BG] chat 返回', resp);
    return { success: true, data: resp };
  } catch (err: any) {
    let errorMsg = '';
    let fullResponse = '';
    if (err && typeof err === 'object') {
      errorMsg = (err as any).message || String(err);
      fullResponse = (err as any).fullResponse || (err as any).responseText || '';
    } else {
      errorMsg = String(err);
    }
    console.error('[BG] chat 异常', errorMsg, fullResponse, err);
    return { success: false, error: errorMsg, fullResponse };
  }
});

// 注册 getStatus 消息处理器
messenger.on('getStatus', async () => {
  return { status: '正常' };
});

// 注册 GET_VISITS 消息处理器
messenger.on('GET_VISITS', async (msg) => {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { visits: [] };
  const key = `visits_${dayId}`;
  const visits = (await storage.get<any[]>(key)) || [];
  return { visits };
});

// 注册 PAGE_AI_ANALYSIS 消息处理器，记录分析结果（去重）
messenger.on('PAGE_AI_ANALYSIS', async (msg) => {
  const { url, title, aiResult, timestamp } = msg.payload || msg;
  if (!url || !aiResult) return { success: false };
  // 以日期为 key 归档
  const dayId = new Date(timestamp || Date.now()).toISOString().slice(0, 10);
  const key = `ai_analysis_${dayId}`;
  const list = (await storage.get<any[]>(key)) || [];
  // 去重：同一 url+timestamp 不重复
  if (!list.some(item => item.url === url && item.timestamp === timestamp)) {
    list.push({ url, title, aiResult, timestamp });
    await storage.set(key, list);
    return { success: true };
  } else {
    return { success: true, skipped: true };
  }
});

// 注册 GET_AI_ANALYSIS 消息处理器，支持 popup 查询指定日期的 AI 分析结果
messenger.on('GET_AI_ANALYSIS', async (msg) => {
  const dayId = msg.payload?.dayId;
  if (!dayId) return { analysis: [] };
  const key = `ai_analysis_${dayId}`;
  const analysis = (await storage.get<any[]>(key)) || [];
  return { analysis };
});

// 清除数据通知，避免 message port closed 报错
messenger.on('dataCleared', async () => {
  return { ok: true };
});

// ====== Ollama CORS/Origin 测试 ======
async function testOllamaCorsFetch() {
  try {
    const resp = await fetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1',
        messages: [
          { role: 'system', content: '测试 Chrome 扩展后台 fetch 是否带 Origin/CORS' },
          { role: 'user', content: '你好' }
        ]
      }),
      // 不设置 referrerPolicy，测试默认行为
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      logger.error('[Ollama CORS 测试] 响应非 JSON', { status: resp.status, text });
      throw new Error('Ollama 响应非 JSON: ' + text);
    }
    if (!resp.ok) {
      logger.error('[Ollama CORS 测试] 响应失败', { status: resp.status, data });
      throw new Error('Ollama 响应失败: ' + (data?.error || resp.status));
    }
    // 兼容 Headers.entries() 类型
    const headersObj: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    logger.info('[Ollama CORS 测试] fetch 返回', {
      status: resp.status,
      statusText: resp.statusText,
      headers: headersObj,
      body: text
    });
  } catch (e) {
    logger.error('[Ollama CORS 测试] fetch 异常', e);
  }
}

// 启动时自动测试
//setTimeout(testOllamaCorsFetch, 3000);

// 启动初始化流程
initializeSubsystems().then(() => {
  logger.info('后台脚本初始化完成，扩展已准备就绪');
}).catch(error => {
  logger.error('扩展初始化失败:', error);
});
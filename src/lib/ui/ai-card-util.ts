// 统一的 AI 数据卡片渲染工具
// 用于 sidebar 和 popup 保持一致的卡片样式和内容

export interface AiCardData {
  title?: string;
  pageTitle?: string; // 新增，兼容 pageTitle 字段
  url?: string;
  visitStartTime?: number;
  aiResult?: any;
  analyzeDuration?: number;
}

export function renderAiCard(item: AiCardData, idx = 0): string {
  let aiContent = '';
  let durationStr = '';
  let isStructured = false;
  let rawText = item.aiResult;
  let jsonObj: any = null;
  // 支持 aiResult 为结构化 JSON 或字符串
  if (rawText && typeof rawText === 'string' && rawText.trim().startsWith('{')) {
    try {
      jsonObj = JSON.parse(rawText);
      isStructured = true;
    } catch (e) {
      console.error('[AI内容解析] JSON.parse 失败', { rawText, error: e });
    }
  } else if (rawText && typeof rawText === 'object') {
    jsonObj = rawText;
    isStructured = true;
  }
  // 判断是否重要
  const isImportant = (jsonObj && jsonObj.important === true) || (item.aiResult && typeof item.aiResult === 'object' && item.aiResult.important === true);
  if (isStructured && jsonObj) {
    aiContent = `<div class='ai-summary'>${jsonObj.summary || ''}</div>`;
    if (jsonObj.highlights && Array.isArray(jsonObj.highlights) && jsonObj.highlights.length) {
      aiContent += `<ul class='ai-highlights'>${jsonObj.highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
    }
    if (jsonObj.specialConcerns && Array.isArray(jsonObj.specialConcerns) && jsonObj.specialConcerns.length) {
      aiContent += `<div class='ai-special-concerns'>特别关注：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
    }
    if (isImportant) {
      aiContent += `<div class='ai-important-flag'>⚠️ 该内容被标记为重要</div>`;
    }
  } else if (typeof rawText === 'string') {
    if (rawText && rawText !== '正在进行 AI 分析' && rawText !== '') {
      if (rawText.startsWith('AI 分析失败')) {
        aiContent = `<div class='ai-failed'>${rawText.replace(/\n/g, '<br>')}</div>`;
      } else {
        aiContent = `<div class='ai-plain'>${rawText.replace(/\n/g, '<br>')}</div>`;
      }
    } else if ((rawText === '正在进行 AI 分析' || rawText === '') && !isStructured) {
      aiContent = `<span class='ai-analyzing'>正在进行 AI 分析</span>`;
    } else {
      aiContent = `<span class='ai-empty'>[无分析结果]</span>`;
    }
  } else {
    aiContent = `<span class='ai-empty'>[无分析结果]</span>`;
  }
  if (item.analyzeDuration && item.analyzeDuration > 0) {
    durationStr = `<span class='ai-duration'>(分析用时 ${(item.analyzeDuration / 1000).toFixed(1)} 秒)</span>`;
  }
  // 卡片样式全部用 class，重要高亮加 ai-important-card
  const displayTitle = item.title || item.pageTitle || '';
  const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const cardClass = ['popup-card', isImportant ? 'ai-important-card' : ''].filter(Boolean).join(' ');
  return `
    <div class='${cardClass}'>
      <div class='popup-card-title'>${displayTitle}</div>
      <div class='popup-card-url'>${visitTime}</div>
      <div class='popup-card-content'>${aiContent}</div>
      ${durationStr}
    </div>
  `;
}


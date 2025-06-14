// 统一的 AI 数据卡片渲染工具
// 用于 sidebar 和 popup 保持一致的卡片样式和内容

export interface AiCardData {
  title?: string;
  pageTitle?: string; // 新增，兼容 pageTitle 字段
  url?: string;
  visitStartTime?: number;
  aiResult?: any;
  analyzeDuration?: number;
  analyzingStartTime?: number; // 新增，结构化分析中时间戳
}

function robustParseAiResult(raw: any): { obj: any, plain: string } {
  let obj = raw;
  let plain = '';
  // 递归解析 text 字段和 JSON 字符串
  let depth = 0;
  while (obj && typeof obj === 'object' && typeof obj.text === 'string' && depth < 3) {
    try {
      plain = obj.text;
      obj = JSON.parse(obj.text);
      depth++;
    } catch {
      break;
    }
  }
  if (typeof obj === 'string' && obj.trim().startsWith('{')) {
    try {
      plain = obj;
      obj = JSON.parse(obj);
    } catch {}
  }
  // 只要不是对象就返回 null
  if (!obj || typeof obj !== 'object') {
    return { obj: null, plain: plain || (typeof raw === 'string' ? raw : '') };
  }
  return { obj, plain: '' };
}

export function renderAiCard(item: AiCardData, idx = 0): string {
  let aiContent = '';
  let durationStr = '';
  let rawText = item.aiResult;
  let { obj: jsonObj, plain: fallbackPlain } = robustParseAiResult(rawText);
  // 调试日志：结构化解析结果
  console.log('[AI卡片] robustParseAiResult', { rawText, jsonObj, fallbackPlain });
  const isStructured = !!jsonObj;
  // 判断是否重要
  const isImportant = (jsonObj && jsonObj.important === true) || (item.aiResult && typeof item.aiResult === 'object' && item.aiResult.important === true);
  // 判断分析中（不依赖字符串，仅依赖结构化字段）
  const isAnalyzing = (!item.analyzeDuration && (item.analyzingStartTime || item.visitStartTime));
  if (isAnalyzing) {
    aiContent = `<span class='ai-analyzing'>正在进行 AI 分析</span>`;
  } else if (isStructured && jsonObj) {
    if (jsonObj.important === true) {
      aiContent += `<div class='ai-important-flag'>⚠️ 该内容被标记为重要</div>`;
    }
    aiContent += `<div class='ai-summary'>${jsonObj.summary || ''}</div>`;
    const highlightsArr = Array.isArray(jsonObj.highlights) && jsonObj.highlights.length ? jsonObj.highlights : (Array.isArray(jsonObj.suggestions) ? jsonObj.suggestions : []);
    if (highlightsArr && highlightsArr.length) {
      aiContent += `<ul class='ai-highlights'>${highlightsArr.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
    }
    if (jsonObj.specialConcerns && Array.isArray(jsonObj.specialConcerns) && jsonObj.specialConcerns.length) {
      aiContent += `<div class='ai-special-concerns'>特别关注：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
    }
  } else if (fallbackPlain) {
    // 兜底展示原始内容，不再做正则匹配 summary/highlights
    aiContent = `<div class='ai-plain'>${fallbackPlain.replace(/\n/g, '<br>')}</div>`;
  } else if (typeof rawText === 'string') {
    if (rawText && rawText !== '' && !rawText.startsWith('AI 分析失败')) {
      aiContent = `<div class='ai-plain'>${rawText.replace(/\n/g, '<br>')}</div>`;
    } else if (rawText.startsWith('AI 分析失败')) {
      aiContent = `<div class='ai-failed'>${rawText.replace(/\n/g, '<br>')}</div>`;
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


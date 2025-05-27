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
    } catch {}
  } else if (rawText && typeof rawText === 'object') {
    jsonObj = rawText;
    isStructured = true;
  }
  if (isStructured && jsonObj) {
    // summary
    aiContent = `<div style='font-weight:bold;margin-bottom:4px;'>${jsonObj.summary || ''}</div>`;
    // highlights
    if (jsonObj.highlights && Array.isArray(jsonObj.highlights) && jsonObj.highlights.length) {
      aiContent += `<ul style='margin:4px 0 4px 16px;padding:0;color:#333;font-size:13px;'>${jsonObj.highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
    }
    // specialConcerns
    if (jsonObj.specialConcerns && Array.isArray(jsonObj.specialConcerns) && jsonObj.specialConcerns.length) {
      aiContent += `<div style='color:#e53935;font-size:13px;margin:4px 0;'>特别关注：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
    }
  } else if (typeof rawText === 'string') {
    if (rawText && rawText !== '正在进行 AI 分析' && rawText !== '') {
      if (rawText.startsWith('AI 分析失败')) {
        aiContent = `<div style='color:#e53935;background:#fff3f3;border-radius:4px;padding:6px 8px;'>${rawText.replace(/\n/g, '<br>')}</div>`;
      } else {
        aiContent = `<div style='color:#888;background:#f7f7fa;border-radius:4px;padding:6px 8px;'>${rawText.replace(/\n/g, '<br>')}</div>`;
      }
    } else if ((rawText === '正在进行 AI 分析' || rawText === '') && !isStructured) {
      aiContent = `<span style='color:#1a73e8;'>正在进行 AI 分析</span>`;
    } else {
      aiContent = `<span style='color:#aaa;'>[无分析结果]</span>`;
    }
  } else {
    aiContent = `<span style='color:#aaa;'>[无分析结果]</span>`;
  }
  if (item.analyzeDuration && item.analyzeDuration > 0) {
    durationStr = `<span style='color:#888;font-size:11px;'>(分析用时 ${(item.analyzeDuration / 1000).toFixed(1)} 秒)</span>`;
  }
  // 修正：始终优先显示 title，若无则用 pageTitle
  const displayTitle = item.title || item.pageTitle || '';
  const isImportant = (item.aiResult && typeof item.aiResult === 'object' && item.aiResult.important === true);
  const cardStyle = [
    'border:2px solid',
    isImportant ? '#FFC10A' : '#e0e4ea', ';',
    'border-radius:6px;padding:8px 10px;margin-bottom:8px;',
    'background:',
    isImportant ? 'linear-gradient(90deg,#f8f0a9 0%,#FFEB3B 100%)' : '#fff', ';',
    'box-shadow:0 1px 2px 0 #f2f3f5;'
  ].join(' ');
  const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const titleLine = `<div style='display:flex;justify-content:space-between;align-items:center;'>\n      <div style='font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;'>${displayTitle}</div>\n      <div style='color:#888;font-size:12px;margin-left:8px;flex-shrink:0;'>${visitTime}</div>\n    </div>`;
  const urlLine = `<div style='display:flex;justify-content:space-between;align-items:center;margin-top:2px;'>\n      <a href='${item.url || ''}' target='_blank' style='color:#1a73e8;font-size:12px;word-break:break-all;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;text-decoration:underline;vertical-align:bottom;'>${item.url || ''}</a>\n      <div style='color:#888;font-size:11px;margin-left:8px;flex-shrink:0;'>${durationStr}</div>\n    </div>`;
  return `\n      <div style='${cardStyle}'>\n        <div class='merged-card-header' style='cursor:pointer;'>\n          ${titleLine}\n        </div>\n        <div style='margin-top:6px;'>\n          ${urlLine}\n          <div style='margin-top:4px;'>${aiContent}</div>\n        </div>\n      </div>\n    `;
}

import { messenger } from '../lib/messaging/messenger.js';
import { renderAiCard } from '../lib/ui/ai-card-util.js';
import { config } from '../lib/config/index.js';

function getDayId(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function renderSingleBrief(root: HTMLElement) {
  root.innerHTML = '<div style="color:#888;padding:16px;">加载中...</div>';
  const dayId = getDayId(0);
  const resp = await messenger.send('GET_AI_ANALYSIS', { dayId });
  const analysis = Array.isArray(resp?.analysis) ? resp.analysis : [];
  await messenger.sendWithoutResponse('CLEAR_ICON_STATUS');
  if (!analysis.length) {
    root.innerHTML = '<div style="color:#888;padding:16px;">暂无数据</div>';
    return;
  }
  let item = null;
  let header = '最新分析';
  for (let i = analysis.length - 1; i >= 0; i--) {
    const a = analysis[i];
    const isImportant = a.aiResult && typeof a.aiResult === 'object' && a.aiResult.important === true;
    if (isImportant) {
      item = a;
      header = '最新重要提示';
      break;
    }
    if (!item && a.aiResult) {
      item = a;
    }
  }
  if (!item) {
    root.innerHTML = '<div style="color:#888;padding:16px;">暂无数据</div>';
    return;
  }
  const displayTitle = item.title || item.pageTitle || '--';
  const displayUrl = item.url || '';
  const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  let aiContent = '';
  let durationStr = '';
  let isStructured = false;
  let rawText = item.aiResult;
  let jsonObj: any = null;
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
    aiContent = `<div class='ai-summary'>${jsonObj.summary || ''}</div>`;
    if (jsonObj.highlights && Array.isArray(jsonObj.highlights) && jsonObj.highlights.length) {
      aiContent += `<ul class='ai-highlights'>${jsonObj.highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
    }
    if (jsonObj.specialConcerns && Array.isArray(jsonObj.specialConcerns) && jsonObj.specialConcerns.length) {
      aiContent += `<div class='ai-special-concerns'>特别关注：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
    }
  } else if (typeof rawText === 'string') {
    if (rawText && rawText !== '正在进行 AI 分析' && rawText !== '') {
      if (rawText.startsWith('AI 分析失败')) {
        aiContent = `<div class='ai-failed'>${rawText.replace(/\n/g, '<br>')}</div>`;
      } else {
        aiContent = `<div class='ai-plain'>${rawText.replace(/\n/g, '<br>')}</div>`;
      }
    } else if (rawText === '正在进行 AI 分析' || rawText === '') {
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
  root.innerHTML = `<div class="popup-card">
    <div class="popup-card-header">${header}</div>
    <div class="popup-card-content">${aiContent}</div>
    <div class="popup-card-title">${displayTitle}</div>
    <div class="popup-card-url">${displayUrl} ${visitTime ? (' · ' + visitTime) : ''}</div>
    ${durationStr}
  </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('mergedDataArea') as HTMLElement;
  if (root) renderSingleBrief(root);
});

// 配置变更自动刷新
config.onConfigChanged(() => {
  const root = document.getElementById('mergedDataArea') as HTMLElement;
  if (root) renderSingleBrief(root);
});

// 监听 AI_SERVICE_UNAVAILABLE 消息
messenger.on('AI_SERVICE_UNAVAILABLE', (msg) => {
  let text = '未检测到可用的本地 AI 服务，AI 分析功能已禁用。';
  const details = msg.payload?.details as Record<string, boolean> | undefined;
  if (details) {
    const detailArr = Object.entries(details).map(([k, v]) => `${k}: ${v ? '可用' : '不可用'}`);
    text += '\n' + detailArr.join('，');
  }
  let aiWarn = document.querySelector('.ai-service-unavailable');
  if (!aiWarn) {
    aiWarn = document.createElement('div');
    aiWarn.className = 'ai-service-unavailable';
    document.body.prepend(aiWarn);
  }
  aiWarn.textContent = text;
});
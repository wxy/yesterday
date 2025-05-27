import { messenger } from '../lib/messaging/messenger.js';
import { renderAiCard } from '../lib/ui/ai-card-util.js';

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
  if (!analysis.length) {
    root.innerHTML = '<div style="color:#888;padding:16px;">暂无数据</div>';
    return;
  }
  // 优先显示最后一个有 AI 分析结果的“重要提示”，否则显示最后一个有分析结果的普通提示
  let itemWithNotify = analysis.slice().reverse().find((a: any) => a.shouldNotify && a.aiResult);
  let item = itemWithNotify || analysis.slice().reverse().find((a: any) => a.aiResult);
  if (!item) {
    root.innerHTML = '<div style="color:#888;padding:16px;">暂无数据</div>';
    return;
  }
  // 直接用该条目的 title、url、visitStartTime，保证有标题和链接
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
    aiContent = `<div style='font-weight:bold;margin-bottom:4px;'>${jsonObj.summary || ''}</div>`;
    if (jsonObj.highlights && Array.isArray(jsonObj.highlights) && jsonObj.highlights.length) {
      aiContent += `<ul style='margin:4px 0 4px 16px;padding:0;color:#333;font-size:13px;'>${jsonObj.highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
    }
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
  root.innerHTML = `<div style="padding:16px;max-width:360px;">
    <div style="font-weight:600;color:#e53935;margin-bottom:8px;">${itemWithNotify ? '重要提示' : '最新分析'}</div>
    <div style="font-size:14px;">${aiContent}</div>
    <div style="color:#888;font-size:12px;margin-top:8px;">${displayTitle}</div>
    <div style="color:#aaa;font-size:11px;">${displayUrl} ${visitTime ? (' · ' + visitTime) : ''}</div>
  </div>`;
}

// 合并访问记录和分析结果，优先用 id 匹配，兼容 url+visitStartTime
function mergeVisitsAndAnalysis(visits: any[], analysis: any[]) {
  const analysisById = new Map<string, any>();
  const analysisByUrlTime = new Map<string, any>();
  for (const a of analysis) {
    if (a.id) analysisById.set(a.id, a);
    if (a.url && a.visitStartTime) analysisByUrlTime.set(`${a.url}||${a.visitStartTime}`, a);
  }
  return visits.map(v => {
    let matchedAnalysis = null;
    if (v.id && analysisById.has(v.id)) {
      matchedAnalysis = analysisById.get(v.id);
    } else if (v.url && v.visitStartTime && analysisByUrlTime.has(`${v.url}||${v.visitStartTime}`)) {
      matchedAnalysis = analysisByUrlTime.get(`${v.url}||${v.visitStartTime}`);
    }
    return {
      ...v,
      aiResult: matchedAnalysis?.aiResult || '',
      analyzeDuration: matchedAnalysis?.analyzeDuration || 0,
      aiJson: matchedAnalysis?.aiJson || null
    };
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('mergedDataArea') as HTMLElement;
  if (root) renderSingleBrief(root);
});
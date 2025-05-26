import { messenger } from '../lib/messaging/messenger.js';

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
  // 优先找 shouldNotify=true 的，找不到就用最新的
  // 修正：直接获取和侧边栏一致的最新一条分析结果
  let item = analysis[analysis.length - 1];
  let aiContent = '';
  let isStructured = false;
  let rawText = item.aiResult;
  let jsonObj = null;
  if (rawText && typeof rawText === 'string' && rawText.trim().startsWith('{')) {
    try {
      let tryText = rawText
        .replace(/\n/g, '')
        .replace(/\r/g, '')
        .replace(/\s+/g, ' ')
        .replace(/([,{])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(tryText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        jsonObj = parsed;
      }
    } catch {}
  }
  if (item.aiJson && typeof item.aiJson === 'object' && !Array.isArray(item.aiJson)) {
    jsonObj = item.aiJson;
  }
  if (jsonObj) {
    const keyMap = (obj: Record<string, any>): Record<string, any> => {
      const map: Record<string, string> = {
        summary: '摘要',
        highlights: '亮点',
        highlight: '亮点',
        points: '要点',
        point: '要点',
        suggestion: '建议',
        important: '亮点', // 新增：兼容 important 字段为亮点
        specialConcerns: '要点', // 新增：兼容 specialConcerns 字段为要点
      };
      const result: Record<string, any> = {};
      for (const k in obj) {
        const lower = k.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(map, lower)) result[map[lower]] = obj[k];
      }
      return result;
    };
    const mapped: Record<string, any> = keyMap(jsonObj);
    let hasContent = false;
    for (const label of ['摘要', '亮点', '要点', '建议']) {
      const val = mapped[label];
      if (Array.isArray(val) && val.some((p: any) => typeof p === 'string' && p.trim())) {
        aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b><ul style='margin:4px 0 4px 18px;'>${val.filter((p: any) => typeof p === 'string' && p.trim()).map((p: any) => `<li>${p}</li>`).join('')}</ul></div>`;
        hasContent = true;
      } else if (typeof val === 'string' && val.trim()) {
        aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b>${val}</div>`;
        hasContent = true;
      } else if (typeof val === 'number' && String(val).trim()) {
        aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b>${val}</div>`;
        hasContent = true;
      }
    }
    if (hasContent) isStructured = true;
  }
  if (!isStructured) {
    if (item.aiResult && typeof item.aiResult === 'string' && item.aiResult !== '正在进行 AI 分析' && item.aiResult !== '') {
      aiContent = `<div style='color:#888;background:#f7f7fa;border-radius:4px;padding:6px 8px;'>${item.aiResult.replace(/\n/g, '<br>')}</div>`;
    } else if (item.aiResult === '正在进行 AI 分析' || item.aiResult === '') {
      aiContent = `<span style='color:#1a73e8;'>正在进行 AI 分析</span>`;
    } else {
      aiContent = `<span style='color:#aaa;'>[无分析结果]</span>`;
    }
  }
  const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  root.innerHTML = `<div style="padding:16px;max-width:360px;">
    <div style="font-weight:600;color:#e53935;margin-bottom:8px;">${item.aiJson?.shouldNotify ? '重要提示' : '最新分析'}</div>
    <div style="font-size:14px;">${aiContent}</div>
    <div style="color:#888;font-size:12px;margin-top:8px;">${item.title || ''}</div>
    <div style="color:#aaa;font-size:11px;">${item.url || ''} ${visitTime ? (' · ' + visitTime) : ''}</div>
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
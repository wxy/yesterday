import { messenger } from '../lib/messaging/messenger.js';
import { _ } from '../lib/i18n/i18n.js';

// 洞察报告渲染（今日/昨日）
export async function renderInsightReport(box: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  let startTime = 0;
  const collapsedKey = `insightCollapsed_${tab}`;
  function renderHeader(aiServiceLabel = '', isToday = false, showGenerate = true) {
    return `<div class='insight-report-header' id='insight-header-row'>
      <div class='insight-report-title'>${_(isToday ? 'sidebar_insight_today' : 'sidebar_insight_yesterday', isToday ? '今日洞察' : '昨日洞察')}</div>
      <div class='insight-header-btns'>
        <button id='regenerateInsightBtn'>${_('sidebar_insight_regenerate', '重新生成')}</button>
        ${isToday && showGenerate ? `<button id='generateTodayInsightBtn'>${_('sidebar_insight_generate', '即刻洞察')}</button>` : ''}
        <span class='insight-ai-label'>${aiServiceLabel || ''}</span>
      </div>
    </div>`;
  }
  function renderContent(resp: any, generating = false, duration = 0) {
    if (generating) {
      return `<div class='insight-report-content insight-report-content--empty'>${_('sidebar_insight_generating', '正在生成...')}${duration > 0 ? `<span class='insight-report-content-duration'>(${_('sidebar_card_duration', '用时')} ${(duration/1000).toFixed(1)}${_('sidebar_card_seconds', '秒')})</span>` : ''}</div>`;
    }
    if (!resp || (!resp.summaries && !resp.summary && !resp.suggestions)) {
      return `<div class='insight-report-content insight-report-content--empty'>${_('sidebar_insight_empty', '暂无洞察')}</div>`;
    }
    const { summaries, suggestions, stats, summary, highlights, specialConcerns } = resp;
    let html = '';
    if (stats) {
      html += `<div class='insight-stats'>
        <div class='insight-stats-row-label'>${_('sidebar_insight_stats_total', '访问总数')}</div><div class='insight-stats-row-value'>${stats.total}</div>
        <div class='insight-stats-row-label'>${_('sidebar_insight_stats_duration', '总时长')}</div><div class='insight-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)}${_('sidebar_card_minutes', '分钟')}</div>
        <div class='insight-stats-row-label'>${_('sidebar_insight_stats_domains', '涉及域名')}</div><div class='insight-stats-row-value'>${stats.domains && stats.domains.length ? stats.domains.join('，') : '-'}</div>
        <div class='insight-stats-row-label'>${_('sidebar_insight_stats_keywords', '关键词')}</div><div class='insight-stats-row-value'>${stats.keywords && stats.keywords.length ? stats.keywords.slice(0, 10).join('，') : '-'}</div>
      </div>`;
    }
    if (summaries && Array.isArray(summaries) && summaries.length) {
      html += `<div class='insight-report-content'>${summaries.map(s => s.summary).join('<br>')}</div>`;
    } else if (summary) {
      html += `<div class='insight-report-content'>${summary}</div>`;
    }
    if (suggestions && Array.isArray(suggestions) && suggestions.length) {
      html += `<ul class='insight-highlights'>${suggestions.map((s) => `<li>${s}</li>`).join('')}</ul>`;
    } else {
      if (highlights && Array.isArray(highlights) && highlights.length) {
        html += `<ul class='insight-highlights'>${highlights.map((h) => `<li>${h}</li>`).join('')}</ul>`;
      }
      if (specialConcerns && Array.isArray(specialConcerns) && specialConcerns.length) {
        html += `<div class='insight-special-concerns'>${_('sidebar_insight_special', '特别关注')}: ${specialConcerns.map((c) => c).join('，')}</div>`;
      }
    }
    return html;
  }
  let collapsed = false;
  try {
    const stored = localStorage.getItem(collapsedKey);
    if (stored === '1') collapsed = true;
  } catch {}
  let aiServiceLabel = '';
  if (tab === 'today') {
    const resp = await messenger.send('GET_SUMMARY_REPORT', { dayId }).catch(() => null);
    aiServiceLabel = resp?.aiServiceLabel || '';
    const hasReport = !!(resp && (
      (Array.isArray(resp.summaries) && resp.summaries.length > 0) ||
      (typeof resp.summary === 'string' && resp.summary.trim() !== '') ||
      (Array.isArray(resp.suggestions) && resp.suggestions.length > 0)
    ));
    const showGenerate = !hasReport;
    box.innerHTML = `<div class='insight-report-card${collapsed ? ' insight-report-collapsed' : ''}'>
      ${renderHeader(aiServiceLabel, true, showGenerate)}
      <div id='insight-content-box' style='${collapsed ? 'display:none;' : ''}'>${renderContent(resp)}</div>
    </div>`;
    const headerRow = document.getElementById('insight-header-row');
    if (headerRow) {
      headerRow.onclick = (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        collapsed = !collapsed;
        try { localStorage.setItem(collapsedKey, collapsed ? '1' : '0'); } catch {}
        const card = headerRow.closest('.insight-report-card');
        const contentBox = document.getElementById('insight-content-box');
        if (card && contentBox) {
          card.classList.toggle('insight-report-collapsed', collapsed);
          contentBox.style.display = collapsed ? 'none' : '';
        }
      };
    }
    const genBtn = document.getElementById('generateTodayInsightBtn');
    if (genBtn) {
      genBtn.onclick = async () => {
        startTime = Date.now();
        const contentBox = document.getElementById('insight-content-box');
        if (contentBox) contentBox.innerHTML = renderContent(null, true, 0);
        await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
        let waited = 0;
        let lastResp = null;
        while (waited < 20000) {
          await new Promise(r => setTimeout(r, 800));
          lastResp = await messenger.send('GET_SUMMARY_REPORT', { dayId }).catch(() => null);
          if (lastResp && (lastResp.summaries || lastResp.summary || lastResp.suggestions)) break;
          if (contentBox) contentBox.innerHTML = renderContent(null, true, Date.now() - startTime);
          waited += 800;
        }
        if (contentBox) contentBox.innerHTML = renderContent(lastResp, false, Date.now() - startTime);
        renderInsightReport(box, dayId, tab);
      };
    }
    const regenBtn = document.getElementById('regenerateInsightBtn');
    if (regenBtn) {
      regenBtn.onclick = async () => {
        if (genBtn) genBtn.click();
      };
    }
    return;
  }
  box.innerHTML = `<div class='insight-report-card${collapsed ? ' insight-report-collapsed' : ''}'>
    ${renderHeader('', false, false)}
    <div id='insight-content-box' style='${collapsed ? 'display:none;' : ''}'>${renderContent(null, true, 0)}</div>
  </div>`;
  const headerRow = document.getElementById('insight-header-row');
  if (headerRow) {
    headerRow.onclick = (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      collapsed = !collapsed;
      try { localStorage.setItem(collapsedKey, collapsed ? '1' : '0'); } catch {}
      const card = headerRow.closest('.insight-report-card');
      const contentBox = document.getElementById('insight-content-box');
      if (card && contentBox) {
        card.classList.toggle('insight-report-collapsed', collapsed);
        contentBox.style.display = collapsed ? 'none' : '';
      }
    };
  }
  const contentBox = document.getElementById('insight-content-box');
  startTime = Date.now();
  messenger.send('GET_SUMMARY_REPORT', { dayId }).then((resp) => {
    aiServiceLabel = resp?.aiServiceLabel || '';
    if (contentBox) contentBox.innerHTML = renderContent(resp, false, Date.now() - startTime);
    const header = box.querySelector('.insight-ai-label');
    if (header) header.textContent = aiServiceLabel;
  }).catch(() => {
    if (contentBox) contentBox.innerHTML = `<div style='color:#e53935;padding:12px 0;'>${_('sidebar_insight_error', '昨日洞察加载失败')}</div>`;
  });
  const regenBtn = document.getElementById('regenerateInsightBtn');
  if (regenBtn) {
    regenBtn.onclick = async () => {
      startTime = Date.now();
      if (contentBox) contentBox.innerHTML = renderContent(null, true, 0);
      await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
      let waited = 0;
      let lastResp = null;
      while (waited < 20000) {
        await new Promise(r => setTimeout(r, 800));
        lastResp = await messenger.send('GET_SUMMARY_REPORT', { dayId }).catch(() => null);
        if (lastResp && (lastResp.summaries || lastResp.summary || lastResp.suggestions)) break;
        if (contentBox) contentBox.innerHTML = renderContent(null, true, Date.now() - startTime);
        waited += 800;
      }
      if (contentBox) contentBox.innerHTML = renderContent(lastResp, false, Date.now() - startTime);
    };
  }
}

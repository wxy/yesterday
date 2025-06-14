import { messenger } from '../lib/messaging/messenger.js';
import { _ } from '../lib/i18n/i18n.js';

// 全局折叠状态缓存
const insightCollapseState: Record<string, boolean> = {};

// 洞察报告渲染（结构化联动后端 reportStatusMap，支持进度/失败/重试/用时/AI服务名）
export async function renderInsightReport(box: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  // 只读取数据库，不触发生成
  const insightTitle = tab === 'today' ? _('sidebar_insight_today', '今日洞察') : _('sidebar_insight_yesterday', '昨日洞察');
  const generateNowText = _('sidebar_insight_generate_now', '即刻洞察');
  const loadingText = _('sidebar_insight_loading', '加载中...');
  // 折叠唯一 key
  const collapseKey = `${dayId}_${tab}`;
  let collapsed = insightCollapseState[collapseKey] || false;
  // 箭头 SVG 工具函数
  const getArrowSvg = (collapsed: boolean) => collapsed
    ? `<svg class="insight-collapse-arrow" width="16" height="16" viewBox="0 0 16 16"><polyline points="4,6 8,10 12,6" style="fill:none;stroke:#1976d2;stroke-width:2"/></svg>`
    : `<svg class="insight-collapse-arrow" width="16" height="16" viewBox="0 0 16 16"><polyline points="6,4 10,8 6,12" style="fill:none;stroke:#1976d2;stroke-width:2"/></svg>`;
  // 渲染结构
  box.innerHTML = `<div class='insight-report-card insight-report-card--modern${collapsed ? " collapsed" : ""}'>
    <div class='insight-report-header'>
      <span class='insight-collapse-arrow-wrap'>${getArrowSvg(collapsed)}</span>
      <div class='insight-report-title'>${insightTitle}</div>
      <button id='insight-generate-btn' class='insight-generate-btn'>${generateNowText}</button>
    </div>
    <div id='insight-content-box' class='insight-content-box' style='${collapsed ? "display:none;" : ""}'>
      <div class='insight-report-content'>${loadingText}</div>
      <div class='insight-report-footer' style='margin-top:8px;'>
        <span id='insight-ai-label' class='insight-ai-label insight-footer-label'></span>
        <span id='insight-duration-label' class='insight-duration-label insight-footer-label'></span>
      </div>
    </div>
  </div>`;

  // 只在此处声明变量，后续全部复用
  const generateBtn = document.getElementById('insight-generate-btn') as HTMLButtonElement;
  const aiLabelEl = document.getElementById('insight-ai-label');
  const durationLabelEl = document.getElementById('insight-duration-label');
  const contentBox = document.getElementById('insight-content-box');
  const header = box.querySelector('.insight-report-header') as HTMLElement;
  const contentBoxWrap = box.querySelector('.insight-content-box') as HTMLElement;
  const footer = box.querySelector('.insight-report-footer') as HTMLElement;
  const contentArea = contentBox ? contentBox.querySelector('.insight-report-content') as HTMLElement : null;

  // 新增：结构化状态轮询
  let polling = false;
  let pollTimer: any = null;
  let lastStatus: any = null;

  async function fetchStatusAndRender() {
    let statusResp: any = null;
    try {
      statusResp = await messenger.send('GET_REPORT_STATUS', { dayId });
    } catch {}
    if (!statusResp) statusResp = { status: 'none' };
    const status = statusResp.status;
    // 只要有生成动作，自动展开卡片
    if (status === 'pending' || status === 'running' || status === 'done' || status === 'failed') {
      insightCollapseState[collapseKey] = false;
      const card = box.querySelector('.insight-report-card');
      if (card && card.classList.contains('collapsed')) card.classList.remove('collapsed');
      collapsed = false;
      if (contentBoxWrap) contentBoxWrap.style.display = '';
      if (footer) footer.style.display = '';
      if (header) {
        const arrow = header.querySelector('.insight-collapse-arrow-wrap');
        if (arrow) arrow.innerHTML = getArrowSvg(false);
      }
    }
    // 状态渲染
    if (status === 'pending') {
      if (contentArea) contentArea.innerHTML = '⏳ 正在排队...';
      if (generateBtn) { generateBtn.innerHTML = '排队中...'; generateBtn.disabled = true; }
      if (aiLabelEl) aiLabelEl.textContent = statusResp.aiServiceLabel ? `🤖 ${statusResp.aiServiceLabel}` : '🤖 AI';
      if (durationLabelEl) durationLabelEl.textContent = '';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } else if (status === 'running') {
      if (contentArea) contentArea.innerHTML = '🤖 AI 正在生成日报...';
      if (generateBtn) { generateBtn.innerHTML = '生成中...'; generateBtn.disabled = true; }
      if (aiLabelEl) aiLabelEl.textContent = statusResp.aiServiceLabel ? `🤖 ${statusResp.aiServiceLabel}` : '🤖 AI';
      if (statusResp.startTime && durationLabelEl) {
        const start = statusResp.startTime;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        const update = () => {
          const now = Date.now();
          const seconds = Math.floor((now - start) / 1000);
          if (durationLabelEl) durationLabelEl.textContent = `⌛️${seconds}s`;
        };
        update();
        pollTimer = setInterval(update, 1000);
      }
    } else if (status === 'failed') {
      if (contentArea) contentArea.innerHTML = '<span style="color:#d32f2f;">❌ 生成失败：' + (statusResp.errorMsg || '未知错误') + '</span>';
      if (generateBtn) { generateBtn.innerHTML = '重试'; generateBtn.disabled = false; }
      if (aiLabelEl) aiLabelEl.textContent = statusResp.aiServiceLabel ? `🤖 ${statusResp.aiServiceLabel}` : '';
      if (durationLabelEl) durationLabelEl.textContent = '';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } else if (status === 'done') {
      // 生成完成，拉取实际报告内容
      let resp: any = null;
      try { resp = await messenger.send('GET_SUMMARY_REPORT', { dayId }); } catch {}
      const report = resp && resp.report ? resp.report : null;
      if (!report || (!report.summary && (!report.suggestions || report.suggestions.length === 0))) {
        if (contentArea) contentArea.innerHTML = '暂无洞察';
      } else {
        let html = '';
        const { stats, summary, suggestions, highlights, specialConcerns, important } = report || {};
        if (stats) {
          const statsTotalLabel = _('sidebar_insight_stats_total', '访问总数');
          const statsDurationLabel = _('sidebar_insight_stats_duration', '总时长');
          const statsDomainsLabel = _('sidebar_insight_stats_domains', '涉及域名');
          const statsKeywordsLabel = _('sidebar_insight_stats_keywords', '关键词');
          const minutesLabel = _('sidebar_card_minutes', '分钟');
          html += `<div class='insight-stats'>
            <div class='insight-stats-row-label'>${statsTotalLabel}</div><div class='insight-stats-row-value'>${stats.total}</div>
            <div class='insight-stats-row-label'>${statsDurationLabel}</div><div class='insight-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)}${minutesLabel}</div>
            <div class='insight-stats-row-label'>${statsDomainsLabel}</div><div class='insight-stats-row-value'>${stats.domains && stats.domains.length ? stats.domains.join('，') : '-'}</div>
            <div class='insight-stats-row-label'>${statsKeywordsLabel}</div><div class='insight-stats-row-value'>${stats.keywords && stats.keywords.length ? stats.keywords.slice(0, 10).join('，') : '-'}</div>
          </div>`;
        }
        if (typeof important === 'boolean' && important) {
          html += `<div class='insight-important-flag'>⚠️ ${_('sidebar_insight_important','该内容被标记为重要')}</div>`;
        }
        if (summary) {
          html += `<div class='insight-summary'>${summary}</div>`;
        }
        // 优先展示 highlights 字段，否则 fallback 到 suggestions
        const highlightsArr = Array.isArray(highlights) && highlights.length ? highlights : (Array.isArray(suggestions) ? suggestions : []);
        if (highlightsArr && highlightsArr.length) {
          html += `<ul class='insight-highlights'>${highlightsArr.map((s: string) => `<li>${s}</li>`).join('')}</ul>`;
        }
        if (specialConcerns && Array.isArray(specialConcerns) && specialConcerns.length) {
          html += `<div class='insight-special-concerns'>${_('sidebar_insight_special','特别关注')}：${specialConcerns.map((c: string) => c).join('，')}</div>`;
        }
        if (contentArea) contentArea.innerHTML = html;
      }
      if (generateBtn) { generateBtn.innerHTML = '重新生成'; generateBtn.disabled = false; }
      if (aiLabelEl) aiLabelEl.textContent = report && report.aiServiceLabel ? `🤖 ${report.aiServiceLabel}` : '';
      if (durationLabelEl) durationLabelEl.textContent = report && report.duration > 0 ? `⌛️${(report.duration/1000).toFixed(1)}s` : '';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } else {
      // none 或未知
      let resp: any = null;
      try { resp = await messenger.send('GET_SUMMARY_REPORT', { dayId }); } catch {}
      const report = resp && resp.report ? resp.report : null;
      if (report && (report.summary || (report.suggestions && report.suggestions.length > 0))) {
        let html = '';
        const { stats, summary, suggestions, highlights, specialConcerns, important } = report || {};
        if (stats) {
          const statsTotalLabel = _('sidebar_insight_stats_total', '访问总数');
          const statsDurationLabel = _('sidebar_insight_stats_duration', '总时长');
          const statsDomainsLabel = _('sidebar_insight_stats_domains', '涉及域名');
          const statsKeywordsLabel = _('sidebar_insight_stats_keywords', '关键词');
          const minutesLabel = _('sidebar_card_minutes', '分钟');
          html += `<div class='insight-stats'>
            <div class='insight-stats-row-label'>${statsTotalLabel}</div><div class='insight-stats-row-value'>${stats.total}</div>
            <div class='insight-stats-row-label'>${statsDurationLabel}</div><div class='insight-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)}${minutesLabel}</div>
            <div class='insight-stats-row-label'>${statsDomainsLabel}</div><div class='insight-stats-row-value'>${stats.domains && stats.domains.length ? stats.domains.join('，') : '-'}</div>
            <div class='insight-stats-row-label'>${statsKeywordsLabel}</div><div class='insight-stats-row-value'>${stats.keywords && stats.keywords.length ? stats.keywords.slice(0, 10).join('，') : '-'}</div>
          </div>`;
        }
        if (typeof important === 'boolean' && important) {
          html += `<div class='insight-important-flag'>⚠️ ${_('sidebar_insight_important','该内容被标记为重要')}</div>`;
        }
        if (summary) {
          html += `<div class='insight-summary'>${summary}</div>`;
        }
        // 优先展示 highlights 字段，否则 fallback 到 suggestions
        const highlightsArr = Array.isArray(highlights) && highlights.length ? highlights : (Array.isArray(suggestions) ? suggestions : []);
        if (highlightsArr && highlightsArr.length) {
          html += `<ul class='insight-highlights'>${highlightsArr.map((s: string) => `<li>${s}</li>`).join('')}</ul>`;
        }
        if (specialConcerns && Array.isArray(specialConcerns) && specialConcerns.length) {
          html += `<div class='insight-special-concerns'>${_('sidebar_insight_special','特别关注')}：${specialConcerns.map((c: string) => c).join('，')}</div>`;
        }
        if (contentArea) contentArea.innerHTML = html;
        if (generateBtn) { generateBtn.innerHTML = '重新生成'; generateBtn.disabled = false; }
        if (aiLabelEl) aiLabelEl.textContent = report && report.aiServiceLabel ? `🤖 ${report.aiServiceLabel}` : '';
        if (durationLabelEl) durationLabelEl.textContent = report && report.duration > 0 ? `⌛️${(report.duration/1000).toFixed(1)}s` : '';
      } else {
        if (contentArea) contentArea.innerHTML = '暂无洞察';
        if (generateBtn) { generateBtn.innerHTML = '即刻洞察'; generateBtn.disabled = false; }
        if (aiLabelEl) aiLabelEl.textContent = '';
        if (durationLabelEl) durationLabelEl.textContent = '';
      }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
    lastStatus = status;
  }

  // 轮询状态
  async function pollStatus() {
    polling = true;
    while (polling) {
      await fetchStatusAndRender();
      if (lastStatus === 'done' || lastStatus === 'failed' || lastStatus === 'none') break;
      await new Promise(r => setTimeout(r, 1200));
    }
    polling = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // 生成/重试按钮
  if (generateBtn) generateBtn.onclick = async () => {
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class='insight-regen-spinner'></span>`;
    if (contentBox) contentBox.innerHTML = `<div class='insight-report-content insight-report-content--empty'>${_('sidebar_insight_generating', '正在生成...')}</div>`;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    polling = false;
    // 触发生成
    await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
    // 轮询状态
    pollStatus();
  };

  // 首次渲染时拉取状态
  pollStatus();

  // header 点击切换折叠
  if (header && contentBoxWrap) {
    header.style.cursor = 'pointer';
    header.onclick = () => {
      collapsed = !collapsed;
      contentBoxWrap.style.display = collapsed ? 'none' : '';
      if (footer) footer.style.display = collapsed ? 'none' : '';
      // 箭头切换
      const arrow = header.querySelector('.insight-collapse-arrow-wrap');
      if (arrow) {
        arrow.innerHTML = getArrowSvg(collapsed);
      }
      insightCollapseState[collapseKey] = collapsed;
      // 修正：每次切换后强制刷新 footer 显示，防止内容渲染后 footer 被隐藏
      if (!collapsed && footer) footer.style.display = '';
    };
    // 初始化 footer 显示状态
    if (footer) footer.style.display = collapsed ? 'none' : '';
  }
}

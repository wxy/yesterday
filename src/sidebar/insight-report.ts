import { messenger } from '../lib/messaging/messenger.js';
import { _ } from '../lib/i18n/i18n.js';

// 全局折叠状态缓存
const insightCollapseState: Record<string, boolean> = {};

// 洞察报告渲染（仅显示，不自动生成）
// 注意：本模块与访问记录/AI分析主链路解耦，所有数据只读，不影响主表结构和消息流
export async function renderInsightReport(box: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  // 只读取数据库，不触发生成
  const insightTitle = tab === 'today' ? _('sidebar_insight_today', '今日洞察') : _('sidebar_insight_yesterday', '昨日洞察');
  const generateNowText = _('sidebar_insight_generate_now', '即刻洞察');
  const loadingText = _('sidebar_insight_loading', '加载中...');
  box.innerHTML = `<div class='insight-report-card insight-report-card--modern'>
    <div class='insight-report-header'>
      <div class='insight-report-title'>${insightTitle}</div>
      <button id='insight-generate-btn' class='insight-generate-btn'>${generateNowText}</button>
    </div>
    <div id='insight-content-box' class='insight-content-box'>${loadingText}</div>
    <div class='insight-report-footer'>
      <span id='insight-ai-label' class='insight-ai-label insight-footer-label'></span>
      <span id='insight-duration-label' class='insight-duration-label insight-footer-label'></span>
    </div>
  </div>`;
  const contentBox = document.getElementById('insight-content-box');
  const generateBtn = document.getElementById('insight-generate-btn') as HTMLButtonElement;
  const aiLabelEl = document.getElementById('insight-ai-label');
  const durationLabelEl = document.getElementById('insight-duration-label');
  let resp: any = null;
  try {
    resp = await messenger.send('GET_SUMMARY_REPORT', { dayId });
  } catch {}
  if (!contentBox) return;
  // 新数据结构：report 字段下才有 stats/summary/suggestions
  const report = resp && resp.report ? resp.report : null;
  // 修正：始终从 report 读取 aiServiceLabel/duration
  let aiServiceLabel = report && report.aiServiceLabel ? report.aiServiceLabel : '';
  let duration = report && typeof report.duration === 'number' ? report.duration : 0;
  if (aiLabelEl) aiLabelEl.textContent = aiServiceLabel ? `🤖 ${aiServiceLabel}` : '';
  if (durationLabelEl) durationLabelEl.textContent = duration > 0 ? `⌛️${(duration/1000).toFixed(1)}s` : '';
  if (!report || (!report.summary && (!report.suggestions || report.suggestions.length === 0))) {
    contentBox.innerHTML = `<div class='insight-report-content insight-report-content--empty'>${_('sidebar_insight_empty', '暂无洞察')}</div>`;
    generateBtn.innerHTML = generateNowText;
    generateBtn.disabled = false;
  } else {
    let html = '';
    const { stats, summary, suggestions } = report;
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
    if (summary) {
      html += `<div class='insight-report-content'>${summary}</div>`;
    }
    if (suggestions && suggestions.length) {
      html += `<ul class='insight-highlights'>${suggestions.map((s: string) => `<li>${s}</li>`).join('')}</ul>`;
    }
    contentBox.innerHTML = html;
    // 生成完成后按钮恢复为“重新生成”
    generateBtn.innerHTML = _('sidebar_insight_regenerate', '重新生成');
    generateBtn.disabled = false;
    // CSS 美化：header 左右布局，footer 标签风格与数据卡片一致
    if (!document.getElementById('insight-regen-spinner-style')) {
      const style = document.createElement('style');
      style.id = 'insight-regen-spinner-style';
      style.textContent = `
        .insight-report-card--modern {
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.07);
          padding: 18px 20px 10px 20px;
          margin: 12px 0 18px 0;
          border: 1px solid #e0e0e0;
        }
        .insight-report-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .insight-report-title {
          font-size: 1.1em;
          font-weight: bold;
          color: #1976d2;
          flex: 1;
          text-align: left;
        }
        .insight-generate-btn {
          background: #2196f3;
          color: #fff;
          border: none;
          border-radius: 5px;
          padding: 4px 14px;
          font-size: 0.98em;
          margin-left: 10px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .insight-generate-btn:disabled {
          background: #bdbdbd;
          cursor: not-allowed;
        }
        .insight-content-box {
          margin-top: 8px;
        }
        .insight-report-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 10px;
          min-height: 22px;
        }
        .insight-footer-label {
          font-size: 12px;
          border-radius: 4px;
          padding: 2px 8px;
          margin-left: 0;
          margin-right: 0;
          line-height: 1.6;
          display: inline-block;
        }
        .insight-ai-label {
          color: #1976d2;
          font-weight: 500;
          background: #e3f2fd;
          border: 1px solid #bbdefb;
        }
        .insight-duration-label {
          color: #888;
          background: #f5f7fa;
          border: 1px solid #e0e0e0;
        }
        .insight-regen-spinner {
          display: inline-block;
          width: 18px;
          height: 18px;
          border: 2px solid #bbb;
          border-top: 2px solid #2196f3;
          border-radius: 50%;
          animation: insight-spin 0.8s linear infinite;
          vertical-align: middle;
        }
        @keyframes insight-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .insight-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 18px;
          margin-bottom: 8px;
        }
        .insight-stats-row-label {
          color: #888;
          min-width: 60px;
          font-size: 0.97em;
        }
        .insight-stats-row-value {
          color: #333;
          font-weight: 500;
          margin-right: 12px;
        }
        .insight-report-content {
          margin: 8px 0 6px 0;
          font-size: 1em;
          color: #222;
        }
        .insight-highlights {
          margin: 0 0 0 18px;
          color: #1976d2;
        }
        .insight-highlights li {
          margin-bottom: 2px;
        }
      `;
      document.head.appendChild(style);
    }
  }
  // 折叠/展开功能
  const header = box.querySelector('.insight-report-header') as HTMLElement;
  const contentBoxWrap = box.querySelector('.insight-content-box') as HTMLElement;
  // 用 dayId+tab 作为唯一 key
  const collapseKey = `${dayId}_${tab}`;
  let collapsed = insightCollapseState[collapseKey] || false;
  if (header && contentBoxWrap) {
    header.style.cursor = 'pointer';
    // 初始渲染时恢复折叠状态
    contentBoxWrap.style.display = collapsed ? 'none' : '';
    header.onclick = () => {
      collapsed = !collapsed;
      contentBoxWrap.style.display = collapsed ? 'none' : '';
      insightCollapseState[collapseKey] = collapsed;
    };
  }
  generateBtn.onclick = async () => {
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class='insight-regen-spinner'></span>`;
    contentBox.innerHTML = `<div class='insight-report-content insight-report-content--empty'>${_('sidebar_insight_generating', '正在生成...')}</div>`;
    const t0 = Date.now();
    await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
    const t1 = Date.now();
    // 生成后刷新
    await renderInsightReport(box, dayId, tab);
    // 生成用时显示（此处为兜底，实际刷新后会由新数据覆盖）
    if (durationLabelEl) durationLabelEl.textContent = `⏱${((t1-t0)/1000).toFixed(1)}s`;
  };
}

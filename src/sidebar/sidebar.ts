import { Logger } from '../lib/logger/logger.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { _ } from '../lib/i18n/i18n.js';
import { shouldAnalyzeUrl } from '../lib/browser-events/url-filter.js';

const logger = new Logger('Sidebar');

// AI服务配置缓存
let aiConfigCache: { value: any, ts: number } | null = null;
const AI_CONFIG_CACHE_TTL = 60 * 1000; // 1分钟

function showAnalyzeDuration(analyzeDuration: number) {
  if (typeof analyzeDuration !== 'number' || analyzeDuration <= 0) return '';
  // 只返回格式化秒数，不再加“分析用时”文字
  return `<span class='insight-report-content-duration'>${(analyzeDuration / 1000).toFixed(1)}${_('sidebar_card_seconds', '秒')}</span>`;
}

// 合并访问记录和分析结果，优先用 id 匹配，兼容 url+visitStartTime
// 已迁移为单表，直接用 visits 作为 analysis
async function mergeVisitsAndAnalysis(visits: any[]): Promise<any[]> {
  // 只保留应分析的 url（异步过滤）
  // 已由后台过滤，前端无需再异步 shouldAnalyzeUrl，可直接返回 visits
  return visits;
}

// 获取当前 AI 服务名称（带缓存）
async function getCurrentAiServiceLabel(): Promise<string> {
  const now = Date.now();
  if (aiConfigCache && (now - aiConfigCache.ts < AI_CONFIG_CACHE_TTL)) {
    const serviceId = aiConfigCache.value?.serviceId || 'ollama';
    const labelMap: Record<string, string> = {
      'ollama': _('ai_service_ollama', 'Ollama 本地'),
      'chrome-ai': _('ai_service_chrome_ai', 'Chrome 内置 AI'),
      'openai': _('ai_service_openai', 'OpenAI'),
      'other': _('ai_service_other', '其它'),
    };
    return labelMap[serviceId] || serviceId;
  }
  try {
    // 通过 messenger 请求后台当前 AI 配置
    const resp = await messenger.send('GET_CONFIG', { key: 'aiServiceConfig' });
    aiConfigCache = { value: resp?.value, ts: now };
    const serviceId = resp?.value?.serviceId || 'ollama';
    // 本地映射
    const labelMap: Record<string, string> = {
      'ollama': _('ai_service_ollama', 'Ollama 本地'),
      'chrome-ai': _('ai_service_chrome_ai', 'Chrome 内置 AI'),
      'openai': _('ai_service_openai', 'OpenAI'),
      'other': _('ai_service_other', '其它'),
    };
    return labelMap[serviceId] || serviceId;
  } catch {
    return _('ai_service_default', 'AI');
  }
}

// 汇总报告渲染（异步，不阻塞列表）
async function renderSummaryReport(root: HTMLElement, dayId: string) {
  const summaryBox = document.getElementById('summary-report-box');
  if (!summaryBox) return;
  summaryBox.innerHTML = `<div style="color:#888;padding:12px 0;">${_('sidebar_summary_loading', '汇总报告加载中...')}</div>`;
  messenger.send('GET_SUMMARY_REPORT', { dayId }).then((resp) => {
    if (!resp || (!resp.summaries && !resp.summary && !resp.suggestions)) {
      summaryBox.innerHTML = `<div style=\"color:#888;padding:12px 0;\">${_('sidebar_summary_empty', '暂无汇总报告')}</div>`;
      return;
    }
    // 新结构优先
    const { summaries, suggestions, aiServiceLabel, stats, summary, highlights, specialConcerns } = resp;
    let html = `<div class='summary-report-card'>`;
    html += `<div class='summary-report-title'>${_('sidebar_summary_title', '汇总报告')} <span class='summary-ai-label'>${aiServiceLabel || ''}</span> <button id='refreshSummaryBtn' class='summary-refresh-btn'>${_('sidebar_summary_refresh', '刷新')}</button></div>`;
    if (stats) {
      html += `<div class='summary-stats'>
        <div class='summary-stats-row-label'>${_('sidebar_summary_stats_total', '访问总数')}</div><div class='summary-stats-row-value'>${stats.total}</div>
        <div class='summary-stats-row-label'>${_('sidebar_summary_stats_duration', '总时长')}</div><div class='summary-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)}${_('sidebar_card_minutes', '分钟')}</div>
        <div class='summary-stats-row-label'>${_('sidebar_summary_stats_domains', '涉及域名')}</div><div class='summary-stats-row-value'>${stats.domains && stats.domains.length ? stats.domains.join('，') : '-'}</div>
        <div class='summary-stats-row-label'>${_('sidebar_summary_stats_keywords', '关键词')}</div><div class='summary-stats-row-value'>${stats.keywords && stats.keywords.length ? stats.keywords.slice(0, 10).join('，') : '-'}</div>
      </div>`;
    }
    // 汇总主内容
    if (summaries && Array.isArray(summaries) && summaries.length) {
      html += `<div class='summary-report-content'>${summaries.map(s => s.summary).join('<br>')}</div>`;
    } else if (summary) {
      html += `<div class='summary-report-content'>${summary}</div>`;
    }
    // 新结构 suggestions 优先
    if (suggestions && Array.isArray(suggestions) && suggestions.length) {
      html += `<ul class='summary-highlights'>${suggestions.map((s) => `<li>${s}</li>`).join('')}</ul>`;
    } else {
      // 兼容老 highlights/specialConcerns
      if (highlights && Array.isArray(highlights) && highlights.length) {
        html += `<ul class='summary-highlights'>${highlights.map((h) => `<li>${h}</li>`).join('')}</ul>`;
      }
      if (specialConcerns && Array.isArray(specialConcerns) && specialConcerns.length) {
        html += `<div class='summary-special-concerns'>${_('sidebar_summary_special', '特别关注')}: ${specialConcerns.map((c) => c).join('，')}</div>`;
      }
    }
    html += `</div>`;
    summaryBox.innerHTML = html;
    const refreshBtn = document.getElementById('refreshSummaryBtn');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        summaryBox.innerHTML = `<div style='color:#888;padding:12px 0;'>${_('sidebar_summary_refreshing', '正在刷新...')}</div>`;
        await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
        setTimeout(() => renderSummaryReport(root, dayId), 1200);
      };
    }
  }).catch(() => {
    summaryBox.innerHTML = `<div style='color:#e53935;padding:12px 0;'>${_('sidebar_summary_error', '汇总报告加载失败')}</div>`;
  });
}

// Tab切换与主渲染（标签页样式）
let currentTab: 'today' | 'yesterday' = 'today'; // 全局记录当前tab
function renderSidebarTabs(root: HTMLElement) {
  const todayId = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayId = yesterday.toISOString().slice(0, 10);
  currentTab = 'today';
  root.innerHTML = `
    <div class='sidebar-tabs-wrap'>
      <div class='tabs'>
        <button id='tab-today' class='sidebar-tab tab'>${_('sidebar_tab_today', '今日')}</button>
        <button id='tab-yesterday' class='sidebar-tab tab'>${_('sidebar_tab_yesterday', '昨日')}</button>
      </div>
    </div>
    <div id='insight-report-box'></div>
    <div id='merged-view-box'></div>
  `;
  const tabToday = document.getElementById('tab-today');
  const tabYesterday = document.getElementById('tab-yesterday');
  const insightBox = document.getElementById('insight-report-box');
  const mergedBox = document.getElementById('merged-view-box');
  function setActiveTab(tab: 'today' | 'yesterday') {
    tabToday?.classList.toggle('active', tab === 'today');
    tabYesterday?.classList.toggle('active', tab === 'yesterday');
  }
  async function switchTab(tab: 'today' | 'yesterday') {
    currentTab = tab;
    setActiveTab(tab);
    const dayId = tab === 'today' ? todayId : yesterdayId;
    if (insightBox) renderInsightReport(insightBox, dayId, tab);
    if (mergedBox) await renderMergedView(mergedBox, dayId, tab);
    updateOpenTabHighlight(tab); // 切换时也刷新高亮
  }
  tabToday?.addEventListener('click', () => switchTab('today'));
  tabYesterday?.addEventListener('click', () => switchTab('yesterday'));
  // 默认显示今日
  setActiveTab('today');
  if (insightBox) renderInsightReport(insightBox, todayId, 'today');
  if (mergedBox) renderMergedView(mergedBox, todayId, 'today');
}

// 洞察报告渲染（今日/昨日）
async function renderInsightReport(box: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  let startTime = 0;
  // 折叠状态持久化key
  const collapsedKey = `insightCollapsed_${tab}`;
  // 渲染卡片头部（标题+按钮同行）
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
  // 渲染内容区
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
  // 折叠状态，优先读取本地存储
  let collapsed = false;
  try {
    const stored = localStorage.getItem(collapsedKey);
    if (stored === '1') collapsed = true;
  } catch {}
  // 渲染主流程
  let aiServiceLabel = '';
  if (tab === 'today') {
    // 今日洞察：先查数据
    const resp = await messenger.send('GET_SUMMARY_REPORT', { dayId }).catch(() => null);
    aiServiceLabel = resp?.aiServiceLabel || '';
    const showGenerate = !(resp && (resp.summaries || resp.summary || resp.suggestions));
    box.innerHTML = `<div class='insight-report-card${collapsed ? ' insight-report-collapsed' : ''}'>
      ${renderHeader(aiServiceLabel, true, showGenerate)}
      <div id='insight-content-box' style='${collapsed ? 'display:none;' : ''}'>${renderContent(resp)}</div>
    </div>`;
    // 折叠/展开事件
    const headerRow = document.getElementById('insight-header-row');
    if (headerRow) {
      headerRow.onclick = (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        collapsed = !collapsed;
        // 持久化
        try { localStorage.setItem(collapsedKey, collapsed ? '1' : '0'); } catch {}
        const card = headerRow.closest('.insight-report-card');
        const contentBox = document.getElementById('insight-content-box');
        if (card && contentBox) {
          card.classList.toggle('insight-report-collapsed', collapsed);
          contentBox.style.display = collapsed ? 'none' : '';
        }
      };
    }
    // 绑定按钮
    const genBtn = document.getElementById('generateTodayInsightBtn');
    if (genBtn) {
      genBtn.onclick = async () => {
        startTime = Date.now();
        const contentBox = document.getElementById('insight-content-box');
        if (contentBox) contentBox.innerHTML = renderContent(null, true, 0);
        await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
        // 轮询刷新，直到有新数据或超时
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
        // 生成后隐藏即刻洞察按钮
        renderInsightReport(box, dayId, tab);
      };
    }
    // 重新生成按钮
    const regenBtn = document.getElementById('regenerateInsightBtn');
    if (regenBtn) {
      regenBtn.onclick = async () => {
        if (genBtn) genBtn.click();
      };
    }
    return;
  }
  // 昨日洞察
  box.innerHTML = `<div class='insight-report-card${collapsed ? ' insight-report-collapsed' : ''}'>
    ${renderHeader('', false, false)}
    <div id='insight-content-box' style='${collapsed ? 'display:none;' : ''}'>${renderContent(null, true, 0)}</div>
  </div>`;
  // 折叠/展开事件
  const headerRow = document.getElementById('insight-header-row');
  if (headerRow) {
    headerRow.onclick = (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      collapsed = !collapsed;
      // 持久化
      try { localStorage.setItem(collapsedKey, collapsed ? '1' : '0'); } catch {}
      const card = headerRow.closest('.insight-report-card');
      const contentBox = document.getElementById('insight-content-box');
      if (card && contentBox) {
        card.classList.toggle('insight-report-collapsed', collapsed);
        contentBox.style.display = collapsed ? 'none' : '';
      }
    };
  }
  // 先显示 loading
  const contentBox = document.getElementById('insight-content-box');
  startTime = Date.now();
  messenger.send('GET_SUMMARY_REPORT', { dayId }).then((resp) => {
    aiServiceLabel = resp?.aiServiceLabel || '';
    if (contentBox) contentBox.innerHTML = renderContent(resp, false, Date.now() - startTime);
    // 更新 header AI label
    const header = box.querySelector('.insight-ai-label');
    if (header) header.textContent = aiServiceLabel;
  }).catch(() => {
    if (contentBox) contentBox.innerHTML = `<div style='color:#e53935;padding:12px 0;'>${_('sidebar_insight_error', '昨日洞察加载失败')}</div>`;
  });
  // 重新生成按钮
  const regenBtn = document.getElementById('regenerateInsightBtn');
  if (regenBtn) {
    regenBtn.onclick = async () => {
      startTime = Date.now();
      if (contentBox) contentBox.innerHTML = renderContent(null, true, 0);
      await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
      // 轮询刷新，直到有新数据或超时
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

// 访问数据卡片渲染，今日标签下高亮当前打开标签页
async function renderMergedView(root: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  clearAllAnalyzingTimers(); // 渲染前清理所有分析中计时器，防止泄漏
  root.innerHTML = '<div class="text-muted" style="padding:16px;">'+_('sidebar_card_loading', '加载中...')+'</div>';
  const [visits, tabs] = await Promise.all([
    messenger.send('GET_VISITS', { dayId }).then(r => r?.visits || []).catch(() => []), // 后台已用 browsing_visits_
    (tab === 'today' && typeof chrome !== 'undefined' && chrome.tabs) ? new Promise<any[]>(resolve => {
      chrome.tabs.query({}, resolve);
    }) : Promise.resolve([])
  ]);
  let openTabUrls: string[] = [];
  if (tab === 'today' && Array.isArray(tabs)) {
    openTabUrls = tabs.map(t => t.url && typeof t.url === 'string' ? t.url.split('#')[0] : '').filter(Boolean);
  }
  let merged = await mergeVisitsAndAnalysis(visits);
  merged = merged.filter(item => {
    return !!(item && (item.title || item.url));
  });
  merged = merged.slice().sort((a, b) => (b.visitStartTime || 0) - (a.visitStartTime || 0));
  if (!merged.length) {
    root.innerHTML = '<div class="text-muted" style="padding:16px;">'+_('sidebar_card_empty', '无数据')+'</div>';
    return;
  }
  root.innerHTML = merged.map((item, idx) => {
    // 今日标签下，若 url 在 openTabUrls 中则高亮（不再加对钩，也不再依赖 isRefresh）
    const collapsed = idx > 0;
    const entryId = `merged-entry-${idx}`;
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
        aiContent += `<div class='ai-special_concerns'>${_('sidebar_insight_special', '特别关注')}：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
      }
    } else if (typeof rawText === 'string') {
      if (rawText && rawText !== _('sidebar_card_analyzing', '正在进行 AI 分析') && rawText !== '') {
        if (rawText.startsWith(_('sidebar_card_ai_failed', 'AI 分析失败'))) {
          aiContent = `<div class='ai-failed'>${rawText.replace(/\n/g, '<br>')}</div>`;
        } else {
          aiContent = `<div class='ai-plain'>${rawText.replace(/\n/g, '<br>')}</div>`;
        }
      } else if ((rawText === _('sidebar_card_analyzing', '正在进行 AI 分析') || rawText === '') && !isStructured) {
        // 统一分析中分支，始终用标签+计时器，且只在分析中时插入计时器
        const analyzingId = `analyzing-timer-${idx}`;
        let aiServiceLabel = item.aiServiceLabel || '';
        let visitCountLabel = '';
        if (item.visitCount && item.visitCount > 1) {
          visitCountLabel = `<span class='merged-card-visit-count'>（${item.visitCount}${_('sidebar_card_times', '次')}）</span>`;
        }
        const aiLabelHtml = `<span class='merged-card-ai-label' id='ai-label-${idx}'>${aiServiceLabel}${visitCountLabel}</span>`;
        aiContent = `${aiLabelHtml}<span class='ai-analyzing' id='${analyzingId}'>${_('sidebar_card_analyzing', '正在进行 AI 分析')}</span>`;
        setTimeout(() => {
          const el = document.getElementById(analyzingId);
          if (el && item.visitStartTime) {
            startAnalyzingTimer({ el, item, dayId, root, tab, aiLabelHtml });
          }
        }, 0);
      } else {
        aiContent = `<span class='ai-empty'>[${_('sidebar_card_ai_empty', '无分析结果')}]</span>`;
      }
    } else {
      aiContent = `<span class='ai-empty'>[${_('sidebar_card_ai_empty', '无分析结果')}]</span>`;
    }
    if (item.analyzeDuration && item.analyzeDuration > 0) {
      durationStr = showAnalyzeDuration(item.analyzeDuration);
    }
    // 今日标签下，若 url 在 openTabUrls 中则高亮
    let cardClass = 'merged-card';
    if (tab === 'today' && item.url && openTabUrls.includes(item.url.split('#')[0])) {
      cardClass += ' merged-card-open';
    }
    const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const titleLine = `<div class='merged-card-title-line'>
      <div class='merged-card-title'>${item.title || ''}</div>
      <div class='merged-card-time'>${visitTime}</div>
    </div>`;
    const urlLine = `<div class='merged-card-url-line'>
      <a href='${item.url || ''}' target='_blank' class='merged-card-url'>${item.url || ''}</a>
      <!-- 分析用时不再显示在 URL 行 -->
    </div>`;
    // 访问次数标签
    let visitCountLabel = '';
    if (item.visitCount && item.visitCount > 1) {
      visitCountLabel = `<span class='merged-card-visit-count'>${item.visitCount}${_('sidebar_card_times', '次')}</span>`;
    }
    // AI服务标签
    let aiLabelHtml = '';
    if (item.aiServiceLabel) {
      aiLabelHtml = `<span class='merged-card-ai-label'>${item.aiServiceLabel}</span>`;
    }
    // 分析用时标签（精简，仅数字+单位）
    let analyzeDurationLabel = '';
    if (item.analyzeDuration && item.analyzeDuration > 0) {
      analyzeDurationLabel = `<span class='merged-card-analyze-duration'>${(item.analyzeDuration / 1000).toFixed(1)}${_('sidebar_card_seconds_short', 's')}</span>`;
    }
    // 标签区（并列展示，放在 AI 标签旁）
    let cardTagsLine = '';
    if (aiLabelHtml || visitCountLabel || analyzeDurationLabel) {
      cardTagsLine = `<div class='merged-card-tags-line'>${aiLabelHtml}${analyzeDurationLabel}${visitCountLabel}</div>`;
    }
    // aiContent 渲染后不再追加 cardTagsLine，分析中时标签区和计时器只在底部渲染
    let aiContentWithLabel = '';
    let showTags = true;
    if (rawText === _('sidebar_card_analyzing', '正在进行 AI 分析') || rawText === '') {
      // 分析中：只渲染计时器内容，不渲染标签区
      showTags = false;
      const analyzingId = `analyzing-timer-${idx}`;
      aiContentWithLabel = `<span id='${analyzingId}' class='ai-analyzing'>${_('sidebar_card_analyzing', '正在进行 AI 分析')}</span>`;
      setTimeout(() => {
        const el = document.getElementById(analyzingId);
        if (el && item.visitStartTime) {
          startAnalyzingTimer({ el, item, dayId, root, tab, aiLabelHtml: '' });
        }
      }, 0);
    } else {
      aiContentWithLabel = aiContent;
    }
    return `
      <div class='${cardClass}'>
        <div class='merged-card-header' data-entry-id='${entryId}'>
          ${titleLine}
        </div>
        <div id='${entryId}' class='merged-card-content' style='${collapsed ? 'display:none;' : ''}'>
          ${urlLine}
          <div class='merged-card-ai-content'>${aiContentWithLabel}</div>
          ${showTags ? cardTagsLine : ''}
        </div>
      </div>
    `;
  }).join('');
  updateOpenTabHighlight(tab); // 渲染后刷新高亮

  root.onclick = function(e) {
    const target = e.target as HTMLElement;
    if (target && target.classList.contains('merged-card-url')) {
      e.preventDefault();
      const url = target.getAttribute('href');
      if (!url) return;
      chrome.tabs.query({}, (tabs) => {
        const found = tabs.find(tab => tab.url && tab.url.split('#')[0] === url.split('#')[0]);
        if (found && typeof found.id === 'number' && typeof found.windowId === 'number') {
          chrome.tabs.update(found.id, { active: true });
          chrome.windows.update(found.windowId, { focused: true });
        } else {
          chrome.tabs.create({ url });
        }
      });
      return;
    }
    const header = target.closest('.merged-card-header') as HTMLElement;
    if (header && header.dataset.entryId) {
      const entryId = header.dataset.entryId;
      const contentBox = document.getElementById(entryId);
      if (contentBox) {
        const isCollapsed = contentBox.style.display === 'none';
        contentBox.style.display = isCollapsed ? 'block' : 'none';
      }
    }
  };
}

// 刷新“当前打开”卡片高亮，仅更新高亮样式，不刷新全部数据
function updateOpenTabHighlight(tab: 'today' | 'yesterday') {
  if (tab !== 'today') return;
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  chrome.tabs.query({}, (tabs) => {
    const openTabUrls = tabs.map(t => t.url && typeof t.url === 'string' ? t.url.split('#')[0] : '').filter(Boolean);
    const cards = document.querySelectorAll('.merged-card');
    cards.forEach(card => {
      const urlEl = card.querySelector('.merged-card-url') as HTMLAnchorElement;
      if (!urlEl) return;
      const url = urlEl.getAttribute('href')?.split('#')[0] || '';
      if (openTabUrls.includes(url)) {
        card.classList.add('merged-card-open');
      } else {
        card.classList.remove('merged-card-open');
      }
    });
  });
}

// 全局分析中计时器管理，防止重复 interval 泄漏
const analyzingTimers = new Map<string, any>();

function clearAllAnalyzingTimers() {
  for (const timer of analyzingTimers.values()) {
    clearInterval(timer);
  }
  analyzingTimers.clear();
}

// 工具函数：分析中计时器，确保每个 analyzing-timer 只存在一个 interval
function startAnalyzingTimer({ el, item, dayId, root, tab, aiLabelHtml }: {
  el: HTMLElement;
  item: any;
  dayId: string;
  root: HTMLElement;
  tab: 'today' | 'yesterday';
  aiLabelHtml: string;
}) {
  const key = String(item.id);
  if (analyzingTimers.has(key)) {
    clearInterval(analyzingTimers.get(key));
    analyzingTimers.delete(key);
  }
  let timer: any = undefined;
  const updateTextLocal = () => {
    const now = Date.now();
    const seconds = Math.floor((now - item.visitStartTime) / 1000);
    if (seconds >= 60) {
      el.innerHTML = aiLabelHtml + `<span class='ai-failed'>${_('sidebar_card_ai_timeout', '分析超时')}（${_('sidebar_card_duration', '已用时')} ${seconds} ${_('sidebar_card_seconds', '秒')}）</span>`;
      const failedEl = el.querySelector('.ai-failed');
      if (failedEl) failedEl.classList.add('text-error');
      if (timer !== undefined) clearInterval(timer);
      analyzingTimers.delete(key);
      return;
    }
    el.innerHTML = aiLabelHtml + `<span class='ai-analyzing'>${_('sidebar_card_analyzing', '正在进行 AI 分析')}（${_('sidebar_card_duration', '已用时')} ${seconds} ${_('sidebar_card_seconds', '秒')}）</span>`;
  };
  updateTextLocal();
  timer = setInterval(() => {
    if (!document.body.contains(el)) { if (timer !== undefined) clearInterval(timer); analyzingTimers.delete(key); return; }
    updateTextLocal();
  }, 1000);
  analyzingTimers.set(key, timer);
}

async function clearMergedViewData(root: HTMLElement) {
  try {
    logger.info(_('sidebar_clear_data_log', '清除本地数据（不清除配置）'));
    // 只清除 browsing_visits_、browsing_summary_、highlight_records_、page_snapshots_、record_logs_ 等业务数据，保留 config
    const allKeys = await storage.keys();
    const keepPrefixes = ['extension_config', 'app_config', 'config', 'settings']; // 可能的配置表前缀
    const keysToRemove = allKeys.filter(k =>
      !keepPrefixes.some(prefix => k.startsWith(prefix)) &&
      (k.startsWith('browsing_visits_') || k.startsWith('browsing_summary_') || k.startsWith('highlight_records_') || k.startsWith('page_snapshots_') || k.startsWith('record_logs_'))
    );
    await Promise.all(keysToRemove.map(k => storage.remove(k)));
    messenger.send('DATA_CLEARED'); // fire-and-forget，无需等待响应
    root.innerHTML = '<div class="text-muted" style="padding:16px;">'+_('sidebar_card_empty', '无数据')+'</div>';
  } catch (error) {
    logger.error('sidebar_clear_data_failed', _('sidebar_clear_data_failed', '清除数据失败'), error);
    root.innerHTML = '<div class="text-error" style="padding:16px;">'+_('sidebar_clear_data_failed', '清除失败')+'</div>';
  }
}

// 清空AI服务配置缓存
function clearAiConfigCache() {
  aiConfigCache
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('sidebar-root');
  if (root) {
    renderSidebarTabs(root);
    // 只绑定已有按钮事件，不再动态创建按钮
    const clearBtn = document.getElementById('clearDataBtn') as HTMLButtonElement;
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (confirm(_('sidebar_clear_data_confirm', '确定要清除所有本地数据吗？此操作无法撤销。'))) {
          await clearMergedViewData(root);
        }
      };
    }
  }
  // 顶部选项页跳转
  const openOptionsLink = document.getElementById('openOptions') as HTMLAnchorElement;
  if (openOptionsLink) {
    openOptionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
  // 帮助跳转
  const openHelpLink = document.getElementById('openHelp') as HTMLAnchorElement;
  if (openHelpLink) {
    openHelpLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/yourusername/your-extension/wiki' });
    });
  }
  // 版本号
  const versionInfoEl = document.getElementById('versionInfo') as HTMLElement;
  if (versionInfoEl) {
    const manifest = chrome.runtime.getManifest();
    versionInfoEl.textContent = `${_('sidebar_version', '版本：')}${manifest.version}`;
  }
});

// 监听页面标签变化，及时刷新“当前打开”高亮
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onRemoved.addListener(() => updateOpenTabHighlight('today'));
  chrome.tabs.onUpdated.addListener(() => updateOpenTabHighlight('today'));
  chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(() => updateOpenTabHighlight('today'));
}

// 消息监听：局部刷新
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SIDE_PANEL_UPDATE') {
    clearAiConfigCache();
    const insightBox = document.getElementById('insight-report-box');
    const mergedBox = document.getElementById('merged-view-box');
    // 根据当前tab刷新对应数据
    let dayId: string;
    if (currentTab === 'today') {
      dayId = new Date().toISOString().slice(0, 10);
    } else {
      const yesterday = new Date(Date.now() - 86400000);
      dayId = yesterday.toISOString().slice(0, 10);
    }
    const updateType = msg.payload && msg.payload.updateType;
    if (updateType === 'ai') {
      if (insightBox) renderInsightReport(insightBox, dayId, currentTab);
      if (mergedBox) renderMergedView(mergedBox, dayId, currentTab);
    } else if (updateType === 'visit' && mergedBox) {
      renderMergedView(mergedBox, dayId, currentTab);
    } else {
      if (insightBox) renderInsightReport(insightBox, dayId, currentTab);
      if (mergedBox) renderMergedView(mergedBox, dayId, currentTab);
    }
  }
  // SCROLL_TO_VISIT 消息：滚动并高亮并展开对应卡片
  if (msg && msg.type === 'SCROLL_TO_VISIT' && msg.payload && msg.payload.url) {
    setTimeout(() => {
      const url = msg.payload.url.split('#')[0];
      try {
        const links = document.querySelectorAll('.merged-card-url');
        links.forEach((link) => {
          const href = link.getAttribute('href')?.split('#')[0] || '';
          if (href === url) {
            const card = link.closest('.merged-card');
            if (card) {
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              card.classList.add('merged-card-scroll-focus');
              setTimeout(() => card.classList.remove('merged-card-scroll-focus'), 1600);
              // 展开卡片内容
              const header = card.querySelector('.merged-card-header') as HTMLElement;
              if (header && header.dataset.entryId) {
                const contentBox = document.getElementById(header.dataset.entryId);
                if (contentBox) {
                  contentBox.style.display = 'block';
                }
              }
            }
          }
        });
      } catch (err) {
        // 忽略异常
      }
    }, 300);
  }
});

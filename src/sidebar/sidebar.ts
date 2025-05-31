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
  return `<span style='color:#888;font-size:11px;'>(分析用时 ${(analyzeDuration / 1000).toFixed(1)} 秒)</span>`;
}

// 合并访问记录和分析结果，优先用 id 匹配，兼容 url+visitStartTime
// 已迁移为单表，直接用 visits 作为 analysis
async function mergeVisitsAndAnalysis(visits: any[]): Promise<any[]> {
  // 只保留应分析的 url（异步过滤）
  const filtered = await Promise.all(visits.map(async v => {
    if (!v.url || typeof v.url !== 'string') return v;
    const shouldAnalyze = await shouldAnalyzeUrl(v.url);
    return shouldAnalyze ? v : null;
  }));
  return filtered.filter(Boolean);
}

// 获取当前 AI 服务名称（带缓存）
async function getCurrentAiServiceLabel(): Promise<string> {
  const now = Date.now();
  if (aiConfigCache && (now - aiConfigCache.ts < AI_CONFIG_CACHE_TTL)) {
    const serviceId = aiConfigCache.value?.serviceId || 'ollama';
    const labelMap: Record<string, string> = {
      'ollama': 'Ollama 本地',
      'chrome-ai': 'Chrome 内置 AI',
      'openai': 'OpenAI',
      'other': '其它',
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
      'ollama': 'Ollama 本地',
      'chrome-ai': 'Chrome 内置 AI',
      'openai': 'OpenAI',
      'other': '其它',
    };
    return labelMap[serviceId] || serviceId;
  } catch {
    return 'AI';
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
        <div class='summary-stats-row-label'>${_('sidebar_summary_stats_duration', '总时长')}</div><div class='summary-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)} 分钟</div>
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
  box.innerHTML = '';
  if (tab === 'today') {
    // 今日默认仅显示按钮，按钮居右
    box.innerHTML = `<div class='insight-report-card'>
      <div class='insight-report-title'>${_('sidebar_insight_today', '今日洞察')}</div>
      <div class='insight-generate-btn'><button id='generateTodayInsightBtn'>${_('sidebar_insight_generate', '即刻洞察')}</button></div>
    </div>`;
    const btn = document.getElementById('generateTodayInsightBtn');
    if (btn) {
      btn.onclick = async () => {
        box.innerHTML = `<div style='color:#888;padding:12px 0;'>${_('sidebar_insight_generating', '正在生成...')}</div>`;
        await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
        setTimeout(() => renderInsightReport(box, dayId, tab), 1200);
      };
    }
    // 不自动加载今日洞察
    return;
  }
  // 昨日洞察直接加载
  box.innerHTML = `<div style='color:#888;padding:12px 0;'>${_('sidebar_insight_loading', '昨日洞察加载中...')}</div>`;
  messenger.send('GET_SUMMARY_REPORT', { dayId }).then((resp) => {
    if (!resp || (!resp.summaries && !resp.summary && !resp.suggestions)) {
      box.innerHTML = `<div style=\"color:#888;padding:12px 0;\">${_('sidebar_insight_empty', '暂无昨日洞察')}</div>`;
      return;
    }
    const { summaries, suggestions, aiServiceLabel, stats, summary, highlights, specialConcerns } = resp;
    let html = `<div class='insight-report-card'>`;
    html += `<div class='insight-report-title'>${_('sidebar_insight_yesterday', '昨日洞察')} <span class='insight-ai-label'>${aiServiceLabel || ''}</span></div>`;
    if (stats) {
      html += `<div class='insight-stats'>
        <div class='insight-stats-row-label'>${_('sidebar_insight_stats_total', '访问总数')}</div><div class='insight-stats-row-value'>${stats.total}</div>
        <div class='insight-stats-row-label'>${_('sidebar_insight_stats_duration', '总时长')}</div><div class='insight-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)} 分钟</div>
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
    html += `</div>`;
    box.innerHTML = html;
  }).catch(() => {
    box.innerHTML = `<div style='color:#e53935;padding:12px 0;'>${_('sidebar_insight_error', '昨日洞察加载失败')}</div>`;
  });
}

// 访问数据卡片渲染，今日标签下高亮当前打开标签页
async function renderMergedView(root: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  clearAllAnalyzingTimers(); // 渲染前清理所有分析中计时器，防止泄漏
  root.innerHTML = '<div style="color:#888;padding:16px;">加载中...</div>';
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
    root.innerHTML = '<div style="color:#888;padding:16px;">无数据</div>';
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
        aiContent += `<div class='ai-special_concerns'>特别关注：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
      }
    } else if (typeof rawText === 'string') {
      if (rawText && rawText !== '正在进行 AI 分析' && rawText !== '') {
        if (rawText.startsWith('AI 分析失败')) {
          aiContent = `<div class='ai-failed'>${rawText.replace(/\n/g, '<br>')}</div>`;
        } else {
          aiContent = `<div class='ai-plain'>${rawText.replace(/\n/g, '<br>')}</div>`;
        }
      } else if ((rawText === '正在进行 AI 分析' || rawText === '') && !isStructured) {
        // 统一分析中分支，始终用标签+计时器，且只在分析中时插入计时器
        const analyzingId = `analyzing-timer-${idx}`;
        let aiServiceLabel = item.aiServiceLabel || '';
        let visitCountLabel = '';
        if (item.visitCount && item.visitCount > 1) {
          visitCountLabel = `<span class='merged-card-visit-count'>（${item.visitCount}次）</span>`;
        }
        const aiLabelHtml = `<span class='merged-card-ai-label' id='ai-label-${idx}'>${aiServiceLabel}${visitCountLabel}</span>`;
        aiContent = `${aiLabelHtml}<span class='ai-analyzing' id='${analyzingId}'>正在进行 AI 分析</span>`;
        setTimeout(() => {
          const el = document.getElementById(analyzingId);
          if (el && item.visitStartTime) {
            startAnalyzingTimer({ el, item, dayId, root, tab, aiLabelHtml });
          }
        }, 0);
      } else {
        aiContent = `<span class='ai-empty'>[无分析结果]</span>`;
      }
    } else {
      aiContent = `<span class='ai-empty'>[无分析结果]</span>`;
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
      <div class='merged-card-duration'>${durationStr}</div>
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
      analyzeDurationLabel = `<span class='merged-card-analyze-duration'>${(item.analyzeDuration / 1000).toFixed(1)}s</span>`;
    }
    // 标签区（并列展示）
    let cardTagsLine = '';
    if (aiLabelHtml || visitCountLabel || analyzeDurationLabel) {
      cardTagsLine = `<div class='merged-card-tags-line'>${aiLabelHtml}${visitCountLabel}${analyzeDurationLabel}</div>`;
    }
    // aiContent 渲染后不再追加 cardTagsLine，分析中时标签区和计时器只在底部渲染
    let aiContentWithLabel = '';
    let showTags = true;
    if (rawText === '正在进行 AI 分析' || rawText === '') {
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
      el.innerHTML = aiLabelHtml + `<span class='ai-failed'>分析超时（已用时 ${seconds} 秒）</span>`;
      const failedEl = el.querySelector('.ai-failed');
      if (failedEl) failedEl.setAttribute('style', 'color:#e53935;');
      if (timer !== undefined) clearInterval(timer);
      analyzingTimers.delete(key);
      return;
    }
    el.innerHTML = aiLabelHtml + `<span class='ai-analyzing'>正在进行 AI 分析（已用时 ${seconds} 秒）</span>`;
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
    logger.info('清除本地数据（不清除配置）');
    // 只清除 browsing_visits_、browsing_summary_、highlight_records_、page_snapshots_、record_logs_ 等业务数据，保留 config
    const allKeys = await storage.keys();
    const keepPrefixes = ['extension_config', 'app_config', 'config', 'settings']; // 可能的配置表前缀
    const keysToRemove = allKeys.filter(k =>
      !keepPrefixes.some(prefix => k.startsWith(prefix)) &&
      (k.startsWith('browsing_visits_') || k.startsWith('browsing_summary_') || k.startsWith('highlight_records_') || k.startsWith('page_snapshots_') || k.startsWith('record_logs_'))
    );
    await Promise.all(keysToRemove.map(k => storage.remove(k)));
    messenger.send('DATA_CLEARED'); // fire-and-forget，无需等待响应
    root.innerHTML = '<div style="color:#888;padding:16px;">无数据</div>';
  } catch (error) {
    logger.error('sidebar_clear_data_failed', '清除数据失败', error);
    root.innerHTML = '<div style="color:#e53935;padding:16px;">清除失败</div>';
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
        if (confirm('确定要清除所有本地数据吗？此操作无法撤销。')) {
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
    versionInfoEl.textContent = `版本：${manifest.version}`;
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
  // SCROLL_TO_VISIT 消息：找不到卡片时直接忽略
  if (msg && msg.type === 'SCROLL_TO_VISIT' && msg.payload && msg.payload.url) {
    setTimeout(() => {
      const url = msg.payload.url;
      try {
        const links = document.querySelectorAll('.merged-card-url');
        let found = false;
        links.forEach((link) => {
          // 原: if (isSystemUrl(url)) return;
          shouldAnalyzeUrl(url).then(shouldAnalyze => { if (!shouldAnalyze) return; /* ...原有后续逻辑... */ });
        });
        // 不再输出警告，未找到直接忽略
      } catch (err) {
        // 忽略异常
      }
    }, 300);
  }
});

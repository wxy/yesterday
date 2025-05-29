import { Logger } from '../lib/logger/logger.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { _ } from '../lib/i18n/i18n.js';
import { isSystemUrl } from '../lib/browser-events/system-url.js';

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
function mergeVisitsAndAnalysis(visits: any[]): any[] {
  return visits;
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
  summaryBox.innerHTML = `<div style="color:#888;padding:12px 0;">${_('sidebar.summary.loading', '汇总报告加载中...')}</div>`;
  messenger.send('GET_SUMMARY_REPORT', { dayId }).then((resp) => {
    if (!resp || (!resp.summaries && !resp.summary && !resp.suggestions)) {
      summaryBox.innerHTML = `<div style=\"color:#888;padding:12px 0;\">${_('sidebar.summary.empty', '暂无汇总报告')}</div>`;
      return;
    }
    // 新结构优先
    const { summaries, suggestions, aiServiceLabel, stats, summary, highlights, specialConcerns } = resp;
    let html = `<div class='summary-report-card'>`;
    html += `<div class='summary-report-title'>${_('sidebar.summary.title', '汇总报告')} <span class='summary-ai-label'>${aiServiceLabel || ''}</span> <button id='refreshSummaryBtn' class='summary-refresh-btn'>${_('sidebar.summary.refresh', '刷新')}</button></div>`;
    if (stats) {
      html += `<div class='summary-stats'>
        <div class='summary-stats-row-label'>${_('sidebar.summary.stats.total', '访问总数')}</div><div class='summary-stats-row-value'>${stats.total}</div>
        <div class='summary-stats-row-label'>${_('sidebar.summary.stats.duration', '总时长')}</div><div class='summary-stats-row-value'>${(stats.totalDuration/1000/60).toFixed(1)} 分钟</div>
        <div class='summary-stats-row-label'>${_('sidebar.summary.stats.domains', '涉及域名')}</div><div class='summary-stats-row-value'>${stats.domains && stats.domains.length ? stats.domains.join('，') : '-'}</div>
        <div class='summary-stats-row-label'>${_('sidebar.summary.stats.keywords', '关键词')}</div><div class='summary-stats-row-value'>${stats.keywords && stats.keywords.length ? stats.keywords.slice(0, 10).join('，') : '-'}</div>
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
        html += `<div class='summary-special-concerns'>${_('sidebar.summary.special', '特别关注')}: ${specialConcerns.map((c) => c).join('，')}</div>`;
      }
    }
    html += `</div>`;
    summaryBox.innerHTML = html;
    const refreshBtn = document.getElementById('refreshSummaryBtn');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        summaryBox.innerHTML = `<div style='color:#888;padding:12px 0;'>${_('sidebar.summary.refreshing', '正在刷新...')}</div>`;
        await messenger.send('GENERATE_SUMMARY_REPORT', { dayId, force: true });
        setTimeout(() => renderSummaryReport(root, dayId), 1200);
      };
    }
  }).catch(() => {
    summaryBox.innerHTML = `<div style='color:#e53935;padding:12px 0;'>${_('sidebar.summary.error', '汇总报告加载失败')}</div>`;
  });
}

// Tab切换与主渲染（标签页样式）
function renderSidebarTabs(root: HTMLElement) {
  const todayId = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayId = yesterday.toISOString().slice(0, 10);
  let currentTab = 'today';
  root.innerHTML = `
    <div class='sidebar-tabs-wrap'>
      <div class='tabs'>
        <button id='tab-today' class='sidebar-tab tab ${currentTab === 'today' ? 'active' : ''}'>${_('sidebar.tab.today', '今日')}</button>
        <button id='tab-yesterday' class='sidebar-tab tab ${currentTab === 'yesterday' ? 'active' : ''}'>${_('sidebar.tab.yesterday', '昨日')}</button>
      </div>
    </div>
    <div id='summary-report-box'></div>
    <div id='merged-view-box'></div>
  `;
  const tabToday = document.getElementById('tab-today');
  const tabYesterday = document.getElementById('tab-yesterday');
  const mergedBox = document.getElementById('merged-view-box');
  const switchTab = async (tab: 'today' | 'yesterday') => {
    currentTab = tab;
    tabToday?.classList.toggle('active', tab === 'today');
    tabYesterday?.classList.toggle('active', tab === 'yesterday');
    const dayId = tab === 'today' ? todayId : yesterdayId;
    renderSummaryReport(root, dayId); // 异步，不阻塞
    if (mergedBox) await renderMergedView(mergedBox, dayId);
  };
  tabToday?.addEventListener('click', () => switchTab('today'));
  tabYesterday?.addEventListener('click', () => switchTab('yesterday'));
  // 默认显示今日
  switchTab('today');
}

async function renderMergedView(root: HTMLElement, dayId: string) {
  root.innerHTML = '<div style="color:#888;padding:16px;">加载中...</div>';
  const [visits] = await Promise.all([
    messenger.send('GET_VISITS', { dayId }).then(r => r?.visits || []).catch(() => [])
  ]);
  // 过滤掉完全无 title/url 的条目，允许无 aiResult 但有 title/url 的访问记录也渲染卡片
  let merged = mergeVisitsAndAnalysis(visits).filter(item => {
    return !!(item && (item.title || item.url));
  });
  merged = merged.slice().sort((a, b) => (b.visitStartTime || 0) - (a.visitStartTime || 0));
  if (!merged.length) {
    root.innerHTML = '<div style="color:#888;padding:16px;">无数据</div>';
    return;
  }
  root.innerHTML = merged.map((item, idx) => {
    const collapsed = idx > 0;
    const entryId = `merged-entry-${idx}`;
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
      } else if (rawText === '正在进行 AI 分析' && !isStructured) {
        // 只在明确为“正在进行 AI 分析”时显示分析中
        const analyzingId = `analyzing-timer-${idx}`;
        aiContent = `<span class='ai-analyzing' id='${analyzingId}'>正在进行 AI 分析</span>`;
        setTimeout(() => {
          const el = document.getElementById(analyzingId);
          if (el && item.visitStartTime) {
            let timer: any = undefined;
            const updateText = () => {
              const currentItem = merged[idx];
              if (currentItem && typeof currentItem.aiResult === 'string' && currentItem.aiResult.startsWith('AI 分析失败')) {
                el.textContent = currentItem.aiResult;
                el.style.color = '#e53935';
                el.style.background = '#fff3f3';
                el.style.borderRadius = '4px';
                el.style.padding = '6px 8px';
                if (timer !== undefined) clearInterval(timer);
                return;
              }
              const now = Date.now();
              const seconds = Math.floor((now - item.visitStartTime) / 1000);
              if (seconds >= 60) {
                el.textContent = `分析超时（已用时 ${seconds} 秒）`;
                el.style.color = '#e53935';
                if (timer !== undefined) clearInterval(timer);
                return;
              }
              el.textContent = `正在进行 AI 分析（已用时 ${seconds} 秒）`;
            };
            updateText();
            timer = setInterval(() => {
              if (!document.body.contains(el)) { if (timer !== undefined) clearInterval(timer); return; }
              updateText();
            }, 1000);
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
    const isImportant = (item.aiResult && typeof item.aiResult === 'object' && item.aiResult.important === true);
    const cardClass = isImportant ? 'merged-card merged-card-important' : 'merged-card';
    const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const titleLine = `<div class='merged-card-title-line'>
      <div class='merged-card-title'>${item.title || ''}</div>
      <div class='merged-card-time'>${visitTime}</div>
    </div>`;
    const urlLine = `<div class='merged-card-url-line'>
      <a href='${item.url || ''}' target='_blank' class='merged-card-url'>${item.url || ''}</a>
      <div class='merged-card-duration'>${durationStr}</div>
    </div>`;
    return `
      <div class='${cardClass}'>
        <div class='merged-card-header' data-entry-id='${entryId}'>
          ${titleLine}
        </div>
        <div id='${entryId}' class='merged-card-content' style='${collapsed ? 'display:none;' : ''}'>
          ${urlLine}
          <div class='merged-card-ai-content'>${aiContent}</div>
        </div>
      </div>
    `;
  }).join('');

  root.onclick = function(e) {
    const target = e.target as HTMLElement;
    // 智能切换标签页：点击链接时优先激活已打开标签页，否则新开
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

async function clearMergedViewData(root: HTMLElement) {
  try {
    logger.info('清除本地数据（不清除配置）');
    // 只清除 visits_、ai_analysis_ 等业务数据，保留 config
    const allKeys = await storage.keys();
    const keepPrefixes = ['extension_config', 'app_config', 'config', 'settings']; // 可能的配置表前缀
    const keysToRemove = allKeys.filter(k =>
      !keepPrefixes.some(prefix => k.startsWith(prefix)) &&
      (k.startsWith('visits_') || k.startsWith('ai_analysis_') || k.startsWith('highlight_') || k.startsWith('page_') || k.startsWith('record_'))
    );
    await Promise.all(keysToRemove.map(k => storage.remove(k)));
    messenger.send('DATA_CLEARED'); // fire-and-forget，无需等待响应
    root.innerHTML = '<div style="color:#888;padding:16px;">无数据</div>';
  } catch (error) {
    logger.error('sidebar.clear_data_failed', '清除数据失败', error);
    root.innerHTML = '<div style="color:#e53935;padding:16px;">清除失败</div>';
  }
}

// 清空AI服务配置缓存
function clearAiConfigCache() {
  aiConfigCache = null;
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SIDE_PANEL_UPDATE') {
    clearAiConfigCache(); // 配置/数据变更时清空缓存
    const root = document.getElementById('sidebar-root');
    if (root) {
      const dayId = new Date().toISOString().slice(0, 10);
      renderMergedView(root, dayId);
    }
  }
  // 新增：收到 SCROLL_TO_VISIT 消消息时滚动并展开对应卡片
  if (msg && msg.type === 'SCROLL_TO_VISIT' && msg.payload && msg.payload.url) {
    setTimeout(() => {
      const url = msg.payload.url;
      try {
        // 查找所有卡片链接
        const links = document.querySelectorAll('.merged-card-url');
        let found = false;
        links.forEach((link) => {
          if (isSystemUrl(url)) return;
          if (link instanceof HTMLAnchorElement && link.href.split('#')[0] === url.split('#')[0]) {
            // 展开卡片
            const cardContent = link.closest('.merged-card-content') as HTMLElement;
            if (cardContent && cardContent.style.display === 'none') {
              cardContent.style.display = 'block';
            }
            // 滚动到卡片
            cardContent?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            found = true;
          }
        });
        if (isSystemUrl(url)) {
          logger.info('系统页面无需定位:', url);
          return;
        }
        if (found) {
          logger.info('已滚动到对应卡片:', url);
        } else {
          // 输出当前所有卡片的 url 便于排查
          const allUrls = Array.from(links).map(link => link instanceof HTMLAnchorElement ? link.href : '').filter(Boolean);
          logger.warn('sidebar_scroll_to_visit_not_found', '未找到对应卡片: {0}，当前卡片URL: {1}', url, allUrls.join(' | '));
        }
      } catch (err) {
        logger.error('sidebar.scroll_to_visit_error', '滚动到卡片时发生错误', err);
      }
    }, 300); // 等待渲染完成
  }
});

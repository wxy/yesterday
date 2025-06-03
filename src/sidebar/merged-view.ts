import { messenger } from '../lib/messaging/messenger.js';
import { _ } from '../lib/i18n/i18n.js';

// 访问记录与AI分析已合并为单表，前端只通过 GET_VISITS 获取数据
function mergeVisitsAndAnalysis(visits: any[]): any[] {
  return visits;
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

export async function renderMergedView(root: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  clearAllAnalyzingTimers(); // 渲染前清理所有分析中计时器，防止泄漏
  root.innerHTML = '<div class="text-muted" style="padding:16px;">'+_('sidebar_card_loading', '加载中...')+'</div>';
  // 恢复 GET_VISITS 消息调用
  const [visits, tabs] = await Promise.all([
    messenger.send('GET_VISITS', { dayId }).then(r => r?.visits || []).catch(() => []),
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
        let aiServiceLabel = '🤖' + (item.aiServiceLabel || '');
        let visitCountLabel = '';
        if (item.visitCount && item.visitCount > 1) {
          visitCountLabel = `<span class='merged-card-visit-count'>🛞 ${item.visitCount}${_('sidebar_card_times', '次')}</span>`;
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
      durationStr = `<span class='insight-report-content-duration'>${(item.analyzeDuration / 1000).toFixed(1)}${_('sidebar_card_seconds_short', 's')}</span>`;
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
      visitCountLabel = `<span class='merged-card-visit-count'>🛞 ${item.visitCount}${_('sidebar_card_times', '次')}</span>`;
    }
    // AI服务标签
    let aiLabelHtml = '';
    if (item.aiServiceLabel) {
      aiLabelHtml = `<span class='merged-card-ai-label'>🤖 ${item.aiServiceLabel}</span>`;
    }
    // 分析用时标签（精简，仅数字+单位）
    let analyzeDurationLabel = '';
    if (item.analyzeDuration && item.analyzeDuration > 0) {
      analyzeDurationLabel = `<span class='merged-card-analyze-duration'>⌛️ ${(item.analyzeDuration / 1000).toFixed(1)}${_('sidebar_card_seconds_short', 's')}</span>`;
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

export { updateOpenTabHighlight, clearAllAnalyzingTimers, mergeVisitsAndAnalysis, startAnalyzingTimer };
// 如有需要，可在此处补充导出其它工具函数

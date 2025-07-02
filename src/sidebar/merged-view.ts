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

// 工具函数：分析中计时器（已废弃，不再使用）
// function startAnalyzingTimer({ el, item, dayId, root, tab, aiLabelHtml }: {
//   el: HTMLElement;
//   item: any;
//   dayId: string;
//   root: HTMLElement;
//   tab: 'today' | 'yesterday';
//   aiLabelHtml: string;
// }) {
//   const key = String(item.id);
//   if (analyzingTimers.has(key)) {
//     clearInterval(analyzingTimers.get(key));
//     analyzingTimers.delete(key);
//   }
//   let timer: any = undefined;
//   const updateTextLocal = () => {
//     const now = Date.now();
//     const seconds = Math.floor((now - item.visitStartTime) / 1000);
//     if (seconds >= 60) {
//       el.innerHTML = aiLabelHtml + `<span class='ai-failed'>${_('sidebar_card_ai_timeout', '分析超时')}（${_('sidebar_card_duration', '已用时')} ${seconds} ${_('sidebar_card_seconds', '秒')}）</span>`;
//       const failedEl = el.querySelector('.ai-failed');
//       if (failedEl) failedEl.classList.add('text-error');
//       if (timer !== undefined) clearInterval(timer);
//       analyzingTimers.delete(key);
//       return;
//     }
//     el.innerHTML = aiLabelHtml + `<span class='ai-analyzing'>${_('sidebar_card_analyzing', '正在进行 AI 分析')}（${_('sidebar_card_duration', '已用时')} ${seconds} ${_('sidebar_card_seconds', '秒')}）</span>`;
//   };
//   updateTextLocal();
//   timer = setInterval(() => {
//     if (!document.body.contains(el)) { if (timer !== undefined) clearInterval(timer); analyzingTimers.delete(key); return; }
//     updateTextLocal();
//   }, 1000);
//   analyzingTimers.set(key, timer);
// }

function robustParseAiResult(raw: any): { obj: any, plain: string } {
  let obj = raw;
  let plain = '';
  let depth = 0;
  while (obj && typeof obj === 'object' && typeof obj.text === 'string' && depth < 3) {
    try {
      plain = obj.text;
      obj = JSON.parse(obj.text);
      depth++;
    } catch {
      break;
    }
  }
  if (typeof obj === 'string' && obj.trim().startsWith('{')) {
    try {
      plain = obj;
      obj = JSON.parse(obj);
    } catch {}
  }
  if (!obj || typeof obj !== 'object') {
    return { obj: null, plain: plain || (typeof raw === 'string' ? raw : '') };
  }
  return { obj, plain: '' };
}

// 显示/隐藏卡片 loading 蒙层
function showCardLoading(cardEl: HTMLElement, text = '处理中...') {
  if (!cardEl) return;
  let mask = cardEl.querySelector('.merged-card-loading-mask') as HTMLElement;
  if (!mask) {
    mask = document.createElement('div');
    mask.className = 'merged-card-loading-mask';
    mask.innerHTML = `<span>${text}</span>`;
    cardEl.appendChild(mask);
  } else {
    mask.innerHTML = `<span>${text}</span>`;
    mask.style.display = 'flex';
  }
}
function hideCardLoading(cardEl: HTMLElement) {
  if (!cardEl) return;
  const mask = cardEl.querySelector('.merged-card-loading-mask') as HTMLElement;
  if (mask) mask.style.display = 'none';
}
// 全局 toast 提示
function showToast(msg: string, duration = 1800) {
  let toast = document.querySelector('.merged-card-toast') as HTMLElement;
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'merged-card-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

export async function renderMergedView(root: HTMLElement, dayId: string, tab: 'today' | 'yesterday') {
  clearAllAnalyzingTimers();
  root.innerHTML = '<div class="text-muted" style="padding:16px;">'+_('sidebar_card_loading', '加载中...')+'</div>';
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
    let aiContent = '';
    let rawText = item.aiResult;
    const { obj: jsonObj, plain: fallbackPlain } = robustParseAiResult(rawText);
    const isStructured = !!jsonObj;
    const isImportant = (jsonObj && jsonObj.important === true) || (item.aiResult && typeof item.aiResult === 'object' && item.aiResult.important === true);
    const collapsed = idx > 0;
    const entryId = `merged-entry-${idx}`;
    let cardClass = 'merged-card';
    if (tab === 'today' && item.url && openTabUrls.includes(item.url.split('#')[0])) {
      cardClass += ' merged-card-open';
    }
    if (tab === 'today' && item.url && !openTabUrls.includes(item.url.split('#')[0])) {
      cardClass += ' tab-closed';
    }
    if (isImportant) {
      cardClass += ' ai-important-card';
    }
    const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    // 关闭按钮
    const closeBtnHtml = `<button class='merged-card-close-btn' data-id='${item.id || ''}' title='删除此条记录'>×</button>`;
    const titleLine = `<div class='merged-card-title-line'>
      <div class='merged-card-title'>${item.title || ''}</div>
      <div class='merged-card-time'>${visitTime}</div>
      ${closeBtnHtml}
    </div>`;
    const urlLine = `<div class='merged-card-url-line'>
      <a href='${item.url || ''}' target='_blank' class='merged-card-url'>${item.url || ''}</a>
    </div>`;
    let aiLabelHtml = '';
    if (item.aiServiceLabel) {
      aiLabelHtml = `<span class='merged-card-ai-label clickable' data-url='${item.url || ''}' data-id='${item.id || ''}' title='点击重新分析'>🤖 ${item.aiServiceLabel}</span>`;
    }
    let visitCountLabel = '';
    if (item.visitCount && item.visitCount > 1) {
      visitCountLabel = `<span class='merged-card-visit-count'>🛞 ${item.visitCount}${_('sidebar_card_times', '次')}</span>`;
    }
    // 结构化分析状态判断
    let analyzeDurationLabel = '';
    let statusLabel = '';
    const status = item.analysisStatus;
    if (status === 'pending') {
      // 等待分析，显示排队用时
      const durationId = `merged-queue-duration-${idx}`;
      analyzeDurationLabel = `<span class='merged-card-analyze-duration' id='${durationId}'>⌛️0${_('sidebar_card_seconds_short', 's')}</span>`;
      statusLabel = `<span class='ai-analyzing'>${_('sidebar_card_ai_pending', '等待分析')}</span>`;
      setTimeout(() => {
        const el = document.getElementById(durationId);
        if (!el) return;
        const start = item.analyzingQueueTime || item.visitStartTime || Date.now();
        const update = () => {
          const now = Date.now();
          const seconds = Math.floor((now - start) / 1000);
          el.textContent = `⌛️${seconds}${_('sidebar_card_seconds_short', 's')}`;
        };
        update();
        const timer = setInterval(() => {
          if (!document.body.contains(el)) { clearInterval(timer); return; }
          update();
        }, 1000);
      }, 0);
    } else if (status === 'running') {
      // 分析中，显示分析用时
      const durationId = `merged-analyzing-duration-${idx}`;
      analyzeDurationLabel = `<span class='merged-card-analyze-duration' id='${durationId}'>⌛️0${_('sidebar_card_seconds_short', 's')}</span>`;
      statusLabel = `<span class='ai-analyzing'>${_('sidebar_card_analyzing', '正在进行 AI 分析')}</span>`;
      setTimeout(() => {
        const el = document.getElementById(durationId);
        if (!el) return;
        const start = item.analyzingStartTime || Date.now();
        const update = () => {
          const now = Date.now();
          const seconds = Math.floor((now - start) / 1000);
          el.textContent = `⌛️${seconds}${_('sidebar_card_seconds_short', 's')}`;
        };
        update();
        const timer = setInterval(() => {
          if (!document.body.contains(el)) { clearInterval(timer); return; }
          update();
        }, 1000);
      }, 0);
    } else if (status === 'done') {
      // 分析完成，显示总用时
      if (item.analyzeDuration && item.analyzeDuration > 0) {
        analyzeDurationLabel = `<span class='merged-card-analyze-duration'>⌛️ ${(item.analyzeDuration / 1000).toFixed(1)}${_('sidebar_card_seconds_short', 's')}</span>`;
      }
    } else if (status === 'failed') {
      statusLabel = `<span class='ai-failed'>${_('sidebar_card_ai_failed', 'AI 分析失败')}</span>`;
    } else if (status === 'none') {
      statusLabel = `<span class='ai-empty'>[${_('sidebar_card_ai_empty', '未分析')}]</span>`;
    }
    // 标签区
    let cardTagsLine = '';
    if (aiLabelHtml || analyzeDurationLabel || visitCountLabel) {
      cardTagsLine = `<div class='merged-card-tags-line'>${aiLabelHtml}${analyzeDurationLabel}${visitCountLabel}</div>`;
    }
    // 内容区
    if (status === 'pending' || status === 'running') {
      aiContent = statusLabel;
    } else if (status === 'done' && isStructured && jsonObj) {
      
      if (jsonObj.important === true) {
        aiContent += `<div class='ai-important-flag'>⚠️ 该内容被标记为重要</div>`;
      }
      // summary 独立渲染，不影响其它字段
      if (jsonObj.summary) {
        aiContent += `<div class='ai-summary'>${jsonObj.summary}</div>`;
      }
      // highlights 独立渲染
      if (Array.isArray(jsonObj.highlights) && jsonObj.highlights.length) {
        aiContent += `<ul class='ai-highlights'>${jsonObj.highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
      }
      // specialConcerns 独立渲染，过滤空字符串
      if (Array.isArray(jsonObj.specialConcerns)) {
        const filtered = jsonObj.specialConcerns.filter((c: string) => c && c.trim());
        if (filtered.length) {
          aiContent += `<div class='ai-special-concerns'>特别关注：${filtered.join('，')}</div>`;
        }
      }
    } else if (status === 'done' && fallbackPlain) {
      aiContent = `<div class='ai-plain'>${fallbackPlain.replace(/\n/g, '<br>')}</div>`;
    } else if (status === 'done' && typeof rawText === 'string') {
      if (rawText && rawText !== '' && !rawText.startsWith(_('sidebar_card_ai_failed', 'AI 分析失败'))) {
        aiContent = `<div class='ai-plain'>${rawText.replace(/\n/g, '<br>')}</div>`;
      } else if (rawText.startsWith(_('sidebar_card_ai_failed', 'AI 分析失败'))) {
        aiContent = `<div class='ai-failed'>${rawText.replace(/\n/g, '<br>')}</div>`;
      } else {
        aiContent = `<span class='ai-empty'>[${_('sidebar_card_ai_empty', '无分析结果')}]</span>`;
      }
    } else if (status === 'failed') {
      aiContent = statusLabel;
    } else {
      aiContent = statusLabel;
    }
    return `
      <div class='${cardClass}'>
        <div class='merged-card-header' data-entry-id='${entryId}'>
          ${titleLine}
        </div>
        <div id='${entryId}' class='merged-card-content' style='${collapsed ? 'display:none;' : ''}'>
          ${urlLine}
          <div class='merged-card-ai-content'>${aiContent}</div>
          ${cardTagsLine}
        </div>
      </div>
    `;
  }).join('');
  updateOpenTabHighlight(tab); // 渲染后刷新高亮

  root.onclick = function(e) {
    const target = e.target as HTMLElement;
    // AI标签点击：重新分析
    if (target && target.classList.contains('merged-card-ai-label')) {
      const url = target.getAttribute('data-url');
      const id = target.getAttribute('data-id');
      if (url && id) {
        // 优先使用 item.payload?.id，如果有则用 payload.id，否则用 item.id
        const idx = Array.from(root.querySelectorAll('.merged-card-ai-label')).indexOf(target);
        const item = merged[idx];
        const realId = (item && item.payload && item.payload.id) ? item.payload.id : id;
        messenger.send('REANALYZE_VISIT', { url, id: realId });
      }
      return;
    }
    // 关闭按钮点击：删除
    if (target && target.classList.contains('merged-card-close-btn')) {
      const id = target.getAttribute('data-id');
      const cardEl = target.closest('.merged-card') as HTMLElement;
      if (id && cardEl) {
        if (confirm('确定要删除此条访问记录吗？')) {
          showCardLoading(cardEl, '正在删除...');
          messenger.send('DELETE_VISIT', { id }).then(() => {
            showToast('已删除');
          }).catch(() => {
            showToast('删除失败');
          }).finally(() => {
            setTimeout(() => hideCardLoading(cardEl), 1000);
          });
        }
      }
      return;
    }
    // 恢复：点击 header 区域任意位置都可折叠/展开
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

export { updateOpenTabHighlight, clearAllAnalyzingTimers, mergeVisitsAndAnalysis };
// 如有需要，可在此处补充导出其它工具函数

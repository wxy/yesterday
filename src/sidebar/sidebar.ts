import { Logger } from '../lib/logger/logger.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { _ } from '../lib/i18n/i18n.js';
import { shouldAnalyzeUrl } from '../lib/utils/url-utils.js';
import { config } from '../lib/config/index.js';
import { renderMergedView, updateOpenTabHighlight, mergeVisitsAndAnalysis, startAnalyzingTimer } from './merged-view.js';
import { renderInsightReport } from './insight-report.js'; // 暂时屏蔽洞察报告相关

const logger = new Logger('Sidebar');

// AI服务配置缓存
let aiConfigCache: { value: any, ts: number } | null = null;
const AI_CONFIG_CACHE_TTL = 60 * 1000; // 1分钟

// Tab切换与主渲染（标签页样式）
let currentTab: 'today' | 'yesterday' = 'today'; // 全局记录当前tab
// 全局记录最近活跃时间（初始为当前时间）
let lastActiveTime = Date.now();

function renderSidebarTabs(root: HTMLElement) {
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
  // 计算“当前活跃日”逻辑：如活跃时间与当前时间间隔<6小时，则以lastActiveTime为准，否则以当前时间为准
  function getActiveDayId(tab: 'today' | 'yesterday') {
    const now = Date.now();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    let base = now;
    if (now - lastActiveTime < SIX_HOURS) {
      base = lastActiveTime;
    }
    if (tab === 'today') {
      return new Date(base).toISOString().slice(0, 10);
    } else {
      return new Date(base - 86400000).toISOString().slice(0, 10);
    }
  }
  async function switchTab(tab: 'today' | 'yesterday') {
    lastActiveTime = Date.now(); // 切tab时刷新活跃时间
    currentTab = tab;
    setActiveTab(tab);
    const dayId = getActiveDayId(tab);
    if (insightBox) renderInsightReport(insightBox, dayId, tab); // 洞察报告相关已屏蔽
    if (mergedBox) await renderMergedView(mergedBox, dayId, tab);
    // updateOpenTabHighlight(tab); // 由 merged-view 内部处理
  }
  tabToday?.addEventListener('click', () => switchTab('today'));
  tabYesterday?.addEventListener('click', () => switchTab('yesterday'));
  // 默认显示今日，初始化也用活跃日
  setActiveTab('today');
  const todayId = getActiveDayId('today');
  if (insightBox) renderInsightReport(insightBox, todayId, 'today'); // 洞察报告相关已屏蔽
  if (mergedBox) renderMergedView(mergedBox, todayId, 'today');
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
          // 清理 sidebar.ts 中的 clearMergedViewData 调用，相关逻辑如需保留可迁移至 merged-view.ts 或重构为工具函数
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

// 配置变更自动刷新
config.onConfigChanged(() => {
  window.location.reload(); // 或调用自定义刷新逻辑
});

// 监听页面标签变化，及时刷新“当前打开”高亮
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onRemoved.addListener(() => updateOpenTabHighlight('today'));
  chrome.tabs.onUpdated.addListener(() => updateOpenTabHighlight('today'));
  chrome.tabs.onActivated && chrome.tabs.onActivated.addListener(() => updateOpenTabHighlight('today'));
}

// 消息监听：局部刷新
messenger.on('SIDE_PANEL_UPDATE', (msg) => {
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
});

messenger.on('SCROLL_TO_VISIT', (msg) => {
  if (msg && msg.payload && msg.payload.url) {
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
      } catch (e) {
        logger.error('滚动到访问记录时出错', e);
      }
    }, 300);
  }
});

// 监听 AI_SERVICE_UNAVAILABLE 消息
messenger.on('AI_SERVICE_UNAVAILABLE', (msg) => {
  let text = '未检测到可用的本地 AI 服务，AI 分析功能已禁用。';
  const details = msg.payload?.details as Record<string, boolean> | undefined;
  if (details) {
    const detailArr = Object.entries(details).map(([k, v]) => `${k}: ${v ? '可用' : '不可用'}`);
    text += '\n' + detailArr.join('，');
  }
  let aiWarn = document.querySelector('.ai-service-unavailable');
  if (!aiWarn) {
    aiWarn = document.createElement('div');
    aiWarn.className = 'ai-service-unavailable';
    document.body.prepend(aiWarn);
  }
  aiWarn.textContent = text;
  // 可选：禁用相关按钮/入口
});

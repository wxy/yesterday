import { Logger } from '../lib/logger/logger.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';
import { i18n, _ } from '../lib/i18n/i18n.js';
import { shouldAnalyzeUrl } from '../lib/utils/url-utils.js';
import { config } from '../lib/config/index.js';
import { renderMergedView, updateOpenTabHighlight, mergeVisitsAndAnalysis, startAnalyzingTimer } from './merged-view.js';
import { renderInsightReport } from './insight-report.js'; 

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
  // 1. 先渲染静态结构，不插入 label
  root.innerHTML = `
    <div class='sidebar-tabs-wrap'>
      <div class='tabs'>
        <button id='tab-today' class='sidebar-tab tab'></button>
        <button id='tab-yesterday' class='sidebar-tab tab'></button>
      </div>
    </div>
    <div id='insight-report-box'></div>
    <div id='merged-view-box'></div>
  `;
  // 2. 用 DOM API 赋值国际化文本
  const tabToday = document.getElementById('tab-today');
  const tabYesterday = document.getElementById('tab-yesterday');
  if (tabToday) tabToday.textContent = _('sidebar_tab_today', '今日');
  if (tabYesterday) tabYesterday.textContent = _('sidebar_tab_yesterday', '昨日');
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

document.addEventListener('DOMContentLoaded', async () => {
  const allConfig = await config.getAll();
  if (allConfig && allConfig.language && allConfig.language !== 'auto') {
    await i18n.changeLanguage(allConfig.language);
    await i18n.apply();
  }
  const root = document.getElementById('sidebar-root');
  if (root) {
    renderSidebarTabs(root);
    // 只绑定已有按钮事件，不再动态创建按钮
    const clearBtn = document.getElementById('clearDataBtn') as HTMLButtonElement;
    if (clearBtn) {
      const clearDataConfirm = _('sidebar_clear_data_confirm', '确定要清除所有本地数据吗？此操作无法撤销。');
      clearBtn.onclick = async () => {
        if (confirm(clearDataConfirm)) {
          // 清理 sidebar.ts 中的 clearMergedViewData 调用，相关逻辑如需保留可迁移至 merged-view.ts 或重构为工具函数
        }
      };
    }
  }
  // 版本号
  const versionInfoEl = document.getElementById('versionInfo') as HTMLElement;
  if (versionInfoEl) {
    const manifest = chrome.runtime.getManifest();
    const versionLabel = _('sidebar_version', '版本：');
    versionInfoEl.textContent = `${versionLabel}${manifest.version}`;
  }
  // 打开选项页按钮
  const openOptionsLink = document.getElementById('openOptions') as HTMLAnchorElement;
  if (openOptionsLink) {
    const openOptionsLabel = _('sidebar_open_options', '打开选项页');
    openOptionsLink.textContent = openOptionsLabel;
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
      // 语言优先级：当前页面lang > navigator.language > en
      let lang = document.documentElement.lang || navigator.language || 'en';
      lang = lang.replace('-', '_').toLowerCase();
      let helpUrl = '';
      if (lang.startsWith('zh')) {
        helpUrl = 'content/help/help-zh_CN.html';
      } else if (lang.startsWith('en')) {
        helpUrl = 'content/help/help-en.html';
      } else {
        // 可扩展更多语言
        helpUrl = 'content/help/help-en.html';
      }
      chrome.tabs.create({ url: helpUrl });
    });
  }
});

// 配置变更自动刷新
config.onConfigChanged(() => {
  // 语言变更时自动刷新 UI
  window.location.reload();
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

// 侧边栏只通过 GET_VISITS 获取数据，所有刷新只走 SIDE_PANEL_UPDATE
// analysis/多表相关逻辑已彻底移除，所有访问/分析数据均由 merged-view 渲染

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
        logger.error('sidebar_scroll_to_visit_error', _('sidebar_scroll_to_visit_error', '滚动到访问记录时出错: {0}'), e instanceof Error ? e.message : String(e));
      }
    }, 300);
  }
});

// 监听 AI_SERVICE_UNAVAILABLE 消息
messenger.on('AI_SERVICE_UNAVAILABLE', (msg) => {
  let text = _('ai_service_unavailable_msg', '未检测到可用的本地 AI 服务，AI 分析功能已禁用。');
  const details = msg.payload?.details as Record<string, boolean> | undefined;
  if (details) {
    const availableLabel = _('ai_service_available', '可用');
    const unavailableLabel = _('ai_service_unavailable', '不可用');
    const commaCn = _('comma_cn', '，');
    const detailArr = Object.entries(details).map(([k, v]) => `${k}: ${v ? availableLabel : unavailableLabel}`);
    text += '\n' + detailArr.join(commaCn);
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

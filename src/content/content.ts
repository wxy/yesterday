// 记录访问起始时间
const visitStartTime = Date.now();
// 生成唯一访问 id
const visitId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ========== 活跃日逻辑支持 ==========
let lastActiveTime = Date.now();
function getActiveDayId(now: number, lastActive: number, tab: 'today' | 'yesterday' = 'today') {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  let base = now;
  if (now - lastActive < SIX_HOURS) {
    base = lastActive;
  }
  if (tab === 'today') {
    return new Date(base).toISOString().slice(0, 10);
  } else {
    return new Date(base - 86400000).toISOString().slice(0, 10);
  }
}

// 直接使用原生API，避免依赖自定义库

// 提取页面主要内容（初版用body文本，后续可用Readability优化）
function extractMainContent() {
  return document.body ? document.body.innerText : '';
}

// 捕获页面信息（允许扩展字段）
function capturePageInfo(): Record<string, any> {
  return {
    url: window.location.href,
    title: document.title,
    mainContent: extractMainContent(),
    visitStartTime,
    id: visitId // 新增唯一 id 字段
  };
}

// 监听页面卸载，计算停留时长并发送数据
window.addEventListener('beforeunload', async () => {
  const visitEndTime = Date.now();
  const duration = Math.max(1, Math.floor((visitEndTime - visitStartTime) / 1000)); // 秒
  const pageInfo = capturePageInfo();
  pageInfo.duration = duration;
  pageInfo.visitEndTime = visitEndTime;
  // 只发送 UPDATE_PAGE_VISIT，结构与主入口一致，id 始终为访问唯一 id
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      chrome.runtime.sendMessage({
        type: 'UPDATE_PAGE_VISIT',
        payload: pageInfo,
        id: pageInfo.id, // 统一 id 字段
        source: 'content',
        timestamp: Date.now()
      });
    } catch (e) {
      if (e && String(e).includes('Extension context invalidated')) {
        // 静默屏蔽
      } else {
        console.error('[Yesterday][ContentScript] sendMessage failed:', {
          type: 'UPDATE_PAGE_VISIT',
          url: window.location.href,
          error: e
        });
        throw e;
      }
    }
  }
});

// 内容脚本主入口：只允许发送 PAGE_VISIT_AND_ANALYZE
(function() {
  function getPageContent() {
    const title = document.title;
    const body = document.body ? document.body.innerText.slice(0, 2000) : '';
    return `${title}\n${body}`;
  }

  async function main() {
    // 生成唯一 id 和访问时间
    lastActiveTime = Date.now();
    const thisVisitId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const thisVisitStartTime = Date.now();
    let isRefresh = false;
    try {
      if (performance && performance.getEntriesByType) {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (nav && nav.type === 'reload') isRefresh = true;
      } else if (performance && (performance as any).navigation) {
        if ((performance as any).navigation.type === 1) isRefresh = true;
      }
    } catch {}
    // 延迟3秒后再发送访问记录和分析请求
    setTimeout(() => {
      const dayId = getActiveDayId(thisVisitStartTime, lastActiveTime, 'today');
      const pageInfo = {
        url: location.href,
        title: document.title,
        mainContent: extractMainContent(),
        visitStartTime: thisVisitStartTime,
        id: thisVisitId,
        isRefresh,
        dayId
      };
      const pageContent = getPageContent();
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({
            type: 'PAGE_VISIT_AND_ANALYZE',
            payload: {
              ...pageInfo,
              content: pageContent
            },
            id: pageInfo.id, // 统一 id 字段
            source: 'content',
            timestamp: Date.now()
          });
        } catch (e) {
          console.error('[Yesterday][ContentScript] sendMessage failed:', {
            type: 'PAGE_VISIT_AND_ANALYZE',
            url: location.href,
            error: e
          });
        }
      }
    }, 3000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(main, 1000);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(main, 1000));
  }
})();

// ========== SPA/前端路由支持：监听页面URL变化，自动采集 ========== //
(function() {
  let lastUrl = location.href;
  let lastVisitId = visitId;
  let lastVisitStartTime = visitStartTime;
  let observerTimer: any = null;

  function sendVisitAndAnalyze() {
    // 生成新访问id和时间
    lastActiveTime = Date.now();
    lastVisitId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    lastVisitStartTime = Date.now();
    // 判断是否为刷新
    let isRefresh = false;
    try {
      if (performance && performance.getEntriesByType) {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        if (nav && nav.type === 'reload') isRefresh = true;
      } else if (performance && (performance as any).navigation) {
        if ((performance as any).navigation.type === 1) isRefresh = true;
      }
    } catch {}
    const dayId = getActiveDayId(lastVisitStartTime, lastActiveTime, 'today');
    // 采集访问记录和内容
    const pageInfo = {
      url: location.href,
      title: document.title,
      mainContent: extractMainContent(),
      visitStartTime: lastVisitStartTime,
      id: lastVisitId,
      isRefresh,
      dayId
    };
    const pageContent = `${document.title}\n${document.body ? document.body.innerText.slice(0, 2000) : ''}`;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({
          type: 'PAGE_VISIT_AND_ANALYZE',
          payload: {
            ...pageInfo,
            content: pageContent
          },
          id: pageInfo.id, // 统一 id 字段
          source: 'content',
          timestamp: Date.now()
        });
      } catch (e) {
        console.error('[Yesterday][ContentScript] sendMessage failed:', {
          type: 'PAGE_VISIT_AND_ANALYZE',
          url: location.href,
          error: e
        });
      }
    }
  }

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      sendVisitAndAnalyze();
    }
  }

  // 劫持 pushState/replaceState
  const rawPushState = history.pushState;
  const rawReplaceState = history.replaceState;
  history.pushState = function(...args) {
    const ret = rawPushState.apply(this, args);
    setTimeout(checkUrlChange, 10);
    return ret;
  };
  history.replaceState = function(...args) {
    const ret = rawReplaceState.apply(this, args);
    setTimeout(checkUrlChange, 10);
    return ret;
  };
  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);

  // 兜底：定时检测URL变化（防止部分SPA未触发事件）
  observerTimer = setInterval(checkUrlChange, 1000);

  // 页面卸载时清理定时器
  window.addEventListener('beforeunload', () => {
    if (observerTimer) clearInterval(observerTimer);
  });
})();

// 发送访问记录、AI分析等相关 key 已统一为 browsing_visits_、browsing_summary_ 等
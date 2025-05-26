// 记录访问起始时间
const visitStartTime = Date.now();
// 生成唯一访问 id
const visitId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
window.addEventListener('beforeunload', () => {
  const visitEndTime = Date.now();
  const duration = Math.max(1, Math.floor((visitEndTime - visitStartTime) / 1000)); // 秒
  const pageInfo = capturePageInfo();
  pageInfo.duration = duration;
  pageInfo.visitEndTime = visitEndTime;
  // 直接用 chrome.runtime.sendMessage，避免依赖自定义消息库
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: 'PAGE_VISIT_RECORD', payload: pageInfo });
    } catch (e) {
      if (e && String(e).includes('Extension context invalidated')) {
        // 静默屏蔽
      } else {
        throw e;
      }
    }
  }
});

// 内容脚本：采集页面内容并通过后台进行本地 Ollama AI 分析
(function() {
  function getPageContent() {
    const title = document.title;
    const body = document.body ? document.body.innerText.slice(0, 2000) : '';
    return `${title}\n${body}`;
  }

  async function main() {
    try {
      console.log('[Yesterday] main 启动');
      const pageContent = getPageContent();
      // 只输出采集动作，不输出正文内容
      console.log('[Yesterday] 页面内容采集');
      chrome.runtime.sendMessage({
        type: 'AI_ANALYZE_REQUEST',
        content: pageContent,
        url: location.href,
        title: document.title,
        visitStartTime, // 兼容老逻辑
        id: visitId // 新增唯一 id 字段
      }, (resp) => {
        console.log('[Yesterday] AI 分析结果:', resp);
        // 可在此处处理 resp.aiContent
      });
    } catch (err) {
      console.error('[Yesterday] main 执行异常:', err);
    }
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
    lastVisitId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    lastVisitStartTime = Date.now();
    // 采集访问记录
    const pageInfo = {
      url: location.href,
      title: document.title,
      mainContent: extractMainContent(),
      visitStartTime: lastVisitStartTime,
      id: lastVisitId
    };
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'PAGE_VISIT_RECORD', payload: pageInfo });
      } catch (e) {}
    }
    // 采集AI分析
    const pageContent = `${document.title}\n${document.body ? document.body.innerText.slice(0, 2000) : ''}`;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({
          type: 'AI_ANALYZE_REQUEST',
          content: pageContent,
          url: location.href,
          title: document.title,
          visitStartTime: lastVisitStartTime,
          id: lastVisitId
        });
      } catch (e) {}
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
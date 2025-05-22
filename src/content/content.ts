// 记录访问起始时间
const visitStartTime = Date.now();

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
    visitStartTime
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
      console.log('[Yesterday] 页面内容采集:', pageContent.slice(0, 200));
      chrome.runtime.sendMessage({
        type: 'AI_ANALYZE_REQUEST',
        content: pageContent,
        url: location.href,
        title: document.title
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
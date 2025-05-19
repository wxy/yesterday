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
    chrome.runtime.sendMessage({ type: 'PAGE_VISIT_RECORD', payload: pageInfo });
  }
});
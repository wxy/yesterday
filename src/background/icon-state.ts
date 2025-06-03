// 图标与状态管理模块
// src/background/icon-state.ts

let processingCount = 0;
let hasTip = false;
let hasReport = false;
let hasError = false;
let processingInterval: any = null;
let processingFrame = 0;

const processingFrames = [
  { "16": "../assets/icons/logo-default-16.png", "48": "../assets/icons/logo-default-48.png" },
  { "16": "../assets/icons/logo-blink-16.png", "48": "../assets/icons/logo-blink-48.png" }
];

// 所有图标/显示灯状态变更必须通过本模块唯一入口（updateIcon/onProcessingStart/onProcessingEnd/setTip/setReport/setError/clearAllIconStatus）
// 禁止前端/内容脚本直接操作 chrome.action.setIcon 等 API，确保链路唯一

export function updateIcon() {
  if (hasError) {
    chrome.action.setIcon({
      path: { "16": "../assets/icons/logo-warn-16.png", "48": "../assets/icons/logo-warn-48.png" }
    });
    stopProcessingAnimation();
    return;
  }
  if (processingCount > 0) {
    startProcessingAnimation();
    return;
  }
  if (hasTip) {
    chrome.action.setIcon({
      path: { "16": "../assets/icons/logo-tips-16.png", "48": "../assets/icons/logo-tips-48.png" }
    });
    stopProcessingAnimation();
    return;
  }
  if (hasReport) {
    chrome.action.setIcon({
      path: { "16": "../assets/icons/logo-report-16.png", "48": "../assets/icons/logo-report-48.png" }
    });
    stopProcessingAnimation();
    return;
  }
  chrome.action.setIcon({
    path: { "16": "../assets/icons/logo-default-16.png", "48": "../assets/icons/logo-default-48.png" }
  });
  stopProcessingAnimation();
}

function startProcessingAnimation() {
  if (processingInterval !== null) return;
  processingInterval = setInterval(() => {
    chrome.action.setIcon({ path: processingFrames[processingFrame % processingFrames.length] });
    processingFrame++;
  }, 400);
}

function stopProcessingAnimation() {
  if (processingInterval !== null) {
    clearInterval(processingInterval);
    processingInterval = null;
    processingFrame = 0;
  }
}

export function onProcessingStart() {
  processingCount++;
  updateIcon();
}

export function onProcessingEnd() {
  processingCount = Math.max(0, processingCount - 1);
  updateIcon();
}

export function setTip(flag: boolean) {
  hasTip = flag;
  updateIcon();
}

export function setReport(flag: boolean) {
  hasReport = flag;
  updateIcon();
}

export function setError(flag: boolean) {
  hasError = flag;
  updateIcon();
}

export function clearAllIconStatus() {
  hasTip = false;
  hasReport = false;
  hasError = false;
  processingCount = 0;
  updateIcon();
}

export function getIconState() {
  return { processingCount, hasTip, hasReport, hasError };
}

// src/background/event-handlers.ts

import { Logger } from '../lib/logger/logger.js';
import { _, _Error } from '../lib/i18n/i18n.js';
import { tryHandleCrossDayTask } from './cross-day.js';
import { EventManager } from '../lib/browser-events/event-manager.js';
import { BrowserEventType } from '../lib/browser-events/event-types.js';
import { AIManager } from '../lib/ai/ai-manager.js';

const logger = new Logger('background/event-handlers');

const eventManager = EventManager.getInstance();
// 注册滚动事件监听
// 只注册一次，避免重复
if (typeof window === 'undefined') {
  eventManager.on(BrowserEventType.TAB_ACTIVATED, handleTabActivatedScrollToVisit);
}

// 处理标签激活时滚动到访问记录
function handleTabActivatedScrollToVisit(event: any) {
  // 兼容 BrowserEvent<any> 类型，event.data 为 tabId
  const tabId = event?.data;
  if (chrome.tabs && chrome.tabs.get && typeof tabId === 'number') {
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.url) {
        chrome.runtime.sendMessage({
          type: 'SCROLL_TO_VISIT',
          payload: { url: tab.url }
        });
      }
    });
  }
}

// 跨日相关事件注册函数
function handleTabActivatedCrossDay(event: any) {
  // 兼容 BrowserEvent<any> 类型，event.data 为 tabId
  tryHandleCrossDayTask();
}

export function registerCrossDayEventListeners() {
  const eventManager = EventManager.getInstance();
  eventManager.on(BrowserEventType.TAB_ACTIVATED, handleTabActivatedCrossDay);
  eventManager.on(BrowserEventType.WINDOW_FOCUSED, tryHandleCrossDayTask);
  eventManager.on(BrowserEventType.WINDOW_CREATED, tryHandleCrossDayTask);
}

// 注册扩展生命周期相关事件（如 onInstalled）
export function registerLifecycleEventListeners() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      // 只做事件分发，具体逻辑如 AI 服务检测由调用方注入
      window.dispatchEvent(new CustomEvent('EXTENSION_INSTALLED'));
    });
  }
}

// 统一注册所有全局事件（浏览器事件、生命周期事件等）
export function registerGlobalEventListeners() {
  registerCrossDayEventListeners();
  registerLifecycleEventListeners();
  // 监听 EXTENSION_INSTALLED 事件，执行 AI 服务检测
  if (typeof window !== 'undefined') {
    window.addEventListener('EXTENSION_INSTALLED', () => {
      AIManager.checkAndNotifyStatus();
    });
  }
}



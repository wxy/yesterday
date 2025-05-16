import { Logger } from '../logger/logger.js';
import { BrowserEventType, EventHandler, EventOptions, BrowserEvent } from './event-types.js';

/**
 * 浏览器事件管理器
 */
export class EventManager {
  private static instance: EventManager;
  private initialized = false;
  private logger: Logger;
  private handlers: Map<string, Set<{ handler: EventHandler, options: EventOptions }>> = new Map();
  private isInitialized: boolean = false;
  
  private constructor() {
    this.logger = new Logger('EventManager');
  }
  
  /**
   * 获取单例实例
   */
  public static getInstance(): EventManager {
    if (!EventManager.instance) {
      EventManager.instance = new EventManager();
    }
    return EventManager.instance;
  }
  
  /**
   * 初始化事件管理器
   */
  public init(): void {
    if (this.isInitialized) {
      return;
    }
    
    this.setupChromeEvents();
    this.isInitialized = true;
    this.logger.debug('浏览器事件管理器已初始化');
  }
  
  /**
   * 设置Chrome扩展事件监听
   */
  private setupChromeEvents(): void {
    if (typeof chrome === 'undefined') {
      this.logger.warn('Chrome API不可用，部分事件监听将不生效');
      return;
    }
    
    // 标签页事件
    if (chrome.tabs) {
      // 标签页创建
      chrome.tabs.onCreated.addListener((tab) => {
        this.dispatchEvent(BrowserEventType.TAB_CREATED, tab);
      });
      
      // 标签页更新
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        this.dispatchEvent(BrowserEventType.TAB_UPDATED, { tabId, changeInfo, tab });
      });
      
      // 标签页激活
      chrome.tabs.onActivated.addListener((activeInfo) => {
        this.dispatchEvent(BrowserEventType.TAB_ACTIVATED, activeInfo);
      });
      
      // 标签页关闭
      chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        this.dispatchEvent(BrowserEventType.TAB_REMOVED, { tabId, removeInfo });
      });
    }
    
    // 窗口事件
    if (chrome.windows) {
      // 窗口创建
      chrome.windows.onCreated.addListener((window) => {
        this.dispatchEvent(BrowserEventType.WINDOW_CREATED, window);
      });
      
      // 窗口关闭
      chrome.windows.onRemoved.addListener((windowId) => {
        this.dispatchEvent(BrowserEventType.WINDOW_REMOVED, windowId);
      });
      
      // 窗口焦点
      chrome.windows.onFocusChanged.addListener((windowId) => {
        this.dispatchEvent(BrowserEventType.WINDOW_FOCUSED, windowId);
      });
    }
    
    // 导航事件
    if (chrome.webNavigation) {
      // 导航提交
      chrome.webNavigation.onCommitted.addListener((details) => {
        this.dispatchEvent(BrowserEventType.NAVIGATION_COMMITTED, details);
      });
      
      // 导航完成
      chrome.webNavigation.onCompleted.addListener((details) => {
        this.dispatchEvent(BrowserEventType.NAVIGATION_COMPLETED, details);
      });
      
      // DOM加载完成
      chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
        this.dispatchEvent(BrowserEventType.NAVIGATION_DOM_CONTENT_LOADED, details);
      });
    }
    
    // 扩展事件
    if (chrome.runtime) {
      // 扩展安装/更新
      chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason === 'install') {
          this.dispatchEvent(BrowserEventType.EXTENSION_INSTALLED, details);
        } else if (details.reason === 'update') {
          this.dispatchEvent(BrowserEventType.EXTENSION_UPDATE_AVAILABLE, details);
        }
      });
      
      // 消息事件
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // 如果有返回值，保持消息通道开启
        const result = this.dispatchEvent(BrowserEventType.MESSAGE_RECEIVED, { message, sender });
        // 自定义处理回复
        return true;
      });
      
      // 外部消息
      if (chrome.runtime.onMessageExternal) {
        chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
          this.dispatchEvent(BrowserEventType.MESSAGE_EXTERNAL, { message, sender });
          return true;
        });
      }
    }
    
    // 存储事件
    if (chrome.storage) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        this.dispatchEvent(BrowserEventType.STORAGE_CHANGED, { changes, areaName });
      });
    }
  }
  
  /**
   * 监听事件
   * @param type 事件类型
   * @param handler 事件处理器
   * @param options 事件选项
   * @returns 取消监听的函数
   */
  public on<T = any>(
    type: BrowserEventType | string, 
    handler: EventHandler<T>, 
    options: EventOptions = {}
  ): () => void {
    // 处理自定义事件类型
    const eventType = type === BrowserEventType.CUSTOM && options.customType 
      ? `${BrowserEventType.CUSTOM}:${options.customType}` 
      : type;
    
    // 确保事件处理器集合存在
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    
    // 添加处理器
    const handlerEntry = { handler, options };
    this.handlers.get(eventType)!.add(handlerEntry);
    
    // 返回取消监听函数
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handlerEntry);
        if (handlers.size === 0) {
          this.handlers.delete(eventType);
        }
      }
    };
  }
  
  /**
   * 监听一次事件
   * @param type 事件类型
   * @param handler 事件处理器
   * @param options 事件选项
   * @returns 取消监听的函数
   */
  public once<T = any>(
    type: BrowserEventType | string, 
    handler: EventHandler<T>, 
    options: EventOptions = {}
  ): () => void {
    return this.on(type, handler, { ...options, once: true });
  }
  
  /**
   * 触发事件
   * @param type 事件类型
   * @param data 事件数据
   * @param customType 自定义事件类型
   * @returns 处理结果(如果有多个处理器，只返回最后一个)
   */
  public dispatchEvent<T = any>(
    type: BrowserEventType | string, 
    data: T, 
    customType?: string
  ): any {
    // 处理自定义事件类型
    const eventType = type === BrowserEventType.CUSTOM && customType 
      ? `${BrowserEventType.CUSTOM}:${customType}` 
      : type;
    
    // 创建事件对象
    const event: BrowserEvent<T> = {
      type: type as BrowserEventType,
      data,
      customType,
      timestamp: Date.now()
    };
    
    // 查找处理器
    const handlers = this.handlers.get(eventType);
    if (!handlers || handlers.size === 0) {
      return undefined;
    }
    
    let lastResult;
    
    // 执行所有处理器
    handlers.forEach((handlerEntry) => {
      try {
        // 创建取消订阅函数
        const unsubscribe = () => {
          handlers.delete(handlerEntry);
        };
        
        // 调用处理器
        lastResult = handlerEntry.handler.call(
          handlerEntry.options.context,
          event,
          unsubscribe
        );
        
        // 处理一次性事件
        if (handlerEntry.options.once) {
          handlers.delete(handlerEntry);
        }
      } catch (error) {
        this.logger.error(`处理事件 "${eventType}" 时出错:`, error);
      }
    });
    
    // 如果是一次性事件并且没有处理器了，清理
    if (handlers.size === 0) {
      this.handlers.delete(eventType);
    }
    
    return lastResult;
  }
  
  /**
   * 发送自定义事件
   * @param customType 自定义事件类型
   * @param data 事件数据
   * @returns 处理结果(如果有多个处理器，只返回最后一个)
   */
  public emit<T = any>(customType: string, data: T): any {
    return this.dispatchEvent(BrowserEventType.CUSTOM, data, customType);
  }
  
  /**
   * 移除事件监听
   * @param type 事件类型
   * @param handler 特定的处理器(可选)
   * @param customType 自定义事件类型
   */
  public off(
    type: BrowserEventType | string,
    handler?: EventHandler,
    customType?: string
  ): void {
    // 处理自定义事件类型
    const eventType = type === BrowserEventType.CUSTOM && customType 
      ? `${BrowserEventType.CUSTOM}:${customType}` 
      : type;
    
    if (!handler) {
      // 移除所有此类型的处理器
      this.handlers.delete(eventType);
    } else {
      // 移除特定处理器
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.forEach(handlerEntry => {
          if (handlerEntry.handler === handler) {
            handlers.delete(handlerEntry);
          }
        });
        
        // 如果没有处理器了，清理
        if (handlers.size === 0) {
          this.handlers.delete(eventType);
        }
      }
    }
  }
  
  /**
   * 移除所有事件监听
   */
  public offAll(): void {
    this.handlers.clear();
  }
  
  /**
   * 获取事件监听数量
   * @param type 事件类型(可选)
   * @returns 监听数量
   */
  public listenerCount(type?: BrowserEventType | string): number {
    if (!type) {
      // 返回所有事件监听数
      let count = 0;
      this.handlers.forEach(handlers => {
        count += handlers.size;
      });
      return count;
    }
    
    // 返回特定类型的事件监听数
    const handlers = this.handlers.get(type);
    return handlers ? handlers.size : 0;
  }
  
  /**
   * 获取所有注册的事件类型
   * @returns 事件类型数组
   */
  public eventTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// 创建并导出单例实例
export const browserEvents = EventManager.getInstance();
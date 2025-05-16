/**
 * 浏览器事件类型枚举
 */
export enum BrowserEventType {
  // 标签页事件
  TAB_CREATED = 'tab:created',
  TAB_UPDATED = 'tab:updated',
  TAB_MOVED = 'tab:moved',
  TAB_ACTIVATED = 'tab:activated',
  TAB_HIGHLIGHTED = 'tab:highlighted',
  TAB_DETACHED = 'tab:detached',
  TAB_ATTACHED = 'tab:attached',
  TAB_REMOVED = 'tab:removed',
  
  // 窗口事件
  WINDOW_CREATED = 'window:created',
  WINDOW_REMOVED = 'window:removed',
  WINDOW_FOCUSED = 'window:focused',
  
  // 导航事件
  NAVIGATION_COMMITTED = 'navigation:committed',
  NAVIGATION_COMPLETED = 'navigation:completed',
  NAVIGATION_DOM_CONTENT_LOADED = 'navigation:domcontentloaded',
  NAVIGATION_ERROR = 'navigation:error',
  NAVIGATION_HISTORY_STATE_UPDATED = 'navigation:historyupdated',
  
  // 扩展事件
  EXTENSION_INSTALLED = 'extension:installed',
  EXTENSION_UNINSTALLED = 'extension:uninstalled',
  EXTENSION_ENABLED = 'extension:enabled',
  EXTENSION_DISABLED = 'extension:disabled',
  EXTENSION_UPDATE_AVAILABLE = 'extension:updateavailable',
  EXTENSION_RESTARTED = 'extension:restarted',
  
  // 消息事件
  MESSAGE_RECEIVED = 'message:received',
  MESSAGE_EXTERNAL = 'message:external',
  
  // 存储事件
  STORAGE_CHANGED = 'storage:changed',
  
  // 网络请求事件
  WEB_REQUEST_BEFORE_REQUEST = 'webrequest:beforerequest',
  WEB_REQUEST_COMPLETED = 'webrequest:completed',
  
  // 书签事件
  BOOKMARK_CREATED = 'bookmark:created',
  BOOKMARK_REMOVED = 'bookmark:removed',
  BOOKMARK_CHANGED = 'bookmark:changed',
  
  // 自定义事件
  CUSTOM = 'custom'
}

/**
 * 事件处理器类型
 */
export type EventHandler<T = any> = (
  event: BrowserEvent<T>, 
  unsubscribe: () => void
) => void;

/**
 * 浏览器事件选项
 */
export interface EventOptions {
  /** 是否只触发一次 */
  once?: boolean;
  /** 事件处理器的上下文 */
  context?: any;
  /** 自定义事件类型 (用于BrowserEventType.CUSTOM) */
  customType?: string;
}

/**
 * 浏览器事件对象
 */
export interface BrowserEvent<T = any> {
  /** 事件类型 */
  type: BrowserEventType;
  /** 事件数据 */
  data: T;
  /** 自定义事件类型 (用于BrowserEventType.CUSTOM) */
  customType?: string;
  /** 事件发生时间 */
  timestamp: number;
}
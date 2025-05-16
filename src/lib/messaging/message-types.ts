/**
 * 消息对象接口
 */
export interface Message<T = any> {
  /**
   * 消息类型
   */
  type: string;
  
  /**
   * 消息负载
   */
  payload?: T;
  
  /**
   * 消息唯一标识符
   */
  id?: string;
  
  /**
   * 消息时间戳
   */
  timestamp?: number;
  
  /**
   * 消息来源
   */
  source?: string;
  /**
   * 消息目标
   * 用于指定消息应该由哪个上下文处理(如 'background', 'content', 'popup')
   */
  target?: string;
}

/**
 * 消息处理函数
 */
export type MessageHandler<T = any, R = any> = (
  message: Message<T>, 
  sender?: chrome.runtime.MessageSender
) => Promise<R> | R;

/**
 * 消息监听器配置
 */
export interface MessageListenerOptions {
  /** 是否只处理一次此消息后自动移除监听器 */
  once?: boolean;
  /** 处理超时时间(毫秒) */
  timeout?: number;
}

/**
 * 消息发送选项
 */
export interface SendMessageOptions {
  /** 目标标签页ID(发送到内容脚本时使用) */
  tabId?: number;
  /** 等待响应的超时时间(毫秒) */
  timeout?: number;
  /** 消息目标标识(例如"popup", "content", "background") */
  target?: string;
}

/**
 * 消息发送超时错误
 */
export class MessageTimeoutError extends Error {
  constructor(messageType: string, timeout: number) {
    super(`Message "${messageType}" timed out after ${timeout}ms`);
    this.name = 'MessageTimeoutError';
  }
}

/**
 * 消息类型定义
 * 定义扩展内部通信使用的各种消息类型
 */

// 消息基本类型
export interface BaseMessage {
  type: string;
}

// 数据请求消息
export interface GetDataMessage extends BaseMessage {
  type: 'GET_DATA';
  dataType: string;
}

// 执行操作消息
export interface PerformActionMessage extends BaseMessage {
  type: 'PERFORM_ACTION';
  action: string;
  params?: any;
}

// 消息响应类型
export interface MessageResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// API响应类型
export interface ApiResponse {
  timestamp: string;
  data: Record<string, any>;
}

// 统计数据类型
export interface StatisticsData {
  runtime: RuntimeStats;
  storage: StorageStats;
}

export interface RuntimeStats {
  version: string;
  daysInstalled: number;
  platform: string;
}

export interface StorageStats {
  itemCount: number;
  lastUpdated: string;
  error?: string;
}

/**
 * 消息发送者接口
 * 基于Chrome扩展API中的消息发送者
 */
export interface MessageSender {
  /**
   * 发送消息的标签页
   */
  tab?: chrome.tabs.Tab;
  
  /**
   * 发送消息的框架ID
   */
  frameId?: number;
  
  /**
   * 发送者的扩展ID
   */
  id?: string;
  
  /**
   * 发送消息的URL
   */
  url?: string;
  
  /**
   * 用于安全通信的TLS通道ID
   */
  tlsChannelId?: string;
  
  /**
   * 消息源
   */
  origin?: string;
  
  /**
   * 发送上下文类型
   */
  documentId?: string;
  
  /**
   * 发送者的文档命名空间
   */
  documentLifecycle?: string;
}
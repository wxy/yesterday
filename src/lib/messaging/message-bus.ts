import { Messenger } from './messenger.js';
import { Message, MessageHandler, MessageListenerOptions, SendMessageOptions } from './message-types.js';

/**
 * 消息总线 - 简化版API接口
 */
export class MessageBus {
  private messenger: Messenger;
  
  constructor() {
    this.messenger = Messenger.getInstance();
  }
  
  /**
   * 初始化消息总线
   * 内部调用messenger的初始化
   */
  public async init(): Promise<void> {
    return this.messenger.init();
  }
  
  /**
   * 注册消息处理器
   */
  public on<T = any, R = any>(
    type: string,
    handler: MessageHandler<T, R>,
    options?: MessageListenerOptions
  ): Promise<() => void> {
    return this.messenger.on(type, handler, options);
  }
  
  /**
   * 注册一次性消息处理器
   */
  public async once<T = any, R = any>(
    type: string,
    handler: MessageHandler<T, R>,
    options?: MessageListenerOptions
  ): Promise<() => void> {
    return this.messenger.once(type, handler, options);
  }
  
  /**
   * 移除消息处理器
   */
  public off(type: string, handler?: MessageHandler): void {
    this.messenger.off(type, handler);
  }
  
  /**
   * 发送消息并等待响应
   */
  public async send<T = any, R = any>(
    type: string,
    payload?: T,
    options?: SendMessageOptions
  ): Promise<R> {
    return this.messenger.send<T, R>(type, payload, options);
  }
  
  /**
   * 发送消息不等待响应
   */
  public emit<T = any>(
    type: string,
    payload?: T,
    options?: SendMessageOptions
  ): void {
    this.messenger.sendWithoutResponse<T>(type, payload, options);
  }
}

// 导出单例
export const messageBus = new MessageBus();
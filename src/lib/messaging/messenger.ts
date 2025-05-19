import { nanoid } from 'nanoid';
import { Logger } from '../logger/logger.js';
import { Message, MessageHandler, MessageListenerOptions, MessageTimeoutError, SendMessageOptions } from './message-types.js';

const logger = new Logger('Messenger');

export class Messenger {
  private static instance: Messenger;
  private handlers: Map<string, Array<{
    handler: MessageHandler,
    options: MessageListenerOptions
  }>> = new Map();
  
  private context: 'background' | 'content' | 'popup' | 'options' = 'content';
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    this.detectContext();
    logger.debug('消息系统实例已创建，当前上下文:', this.context);
  }
  
  public static getInstance(): Messenger {
    if (!Messenger.instance) {
      Messenger.instance = new Messenger();
    }
    return Messenger.instance;
  }
  
  private detectContext(): void {
    // 首先尝试通过URL确定环境
    if (typeof window !== 'undefined') {
      const url = window.location.href || '';
      if (url.includes('/popup.html') || url.includes('/popup/')) {
        this.context = 'popup';
        return;
      } else if (url.includes('/options.html') || url.includes('/options/')) {
        this.context = 'options';
        return;
      }
    }
    
    // 尝试使用API权限判断
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        // 修复语法错误
        if (typeof chrome.runtime.getManifest === 'function' && 
            typeof chrome.extension?.getBackgroundPage === 'function') {
          const backgroundPage = chrome.extension.getBackgroundPage();
          if (backgroundPage === window) {
            this.context = 'background';
            return;
          }
        }
      } catch (error) {
        // 忽略权限错误
        logger.debug('检测背景页时出错，可能是权限问题', error);
      }
    }
    
    // 默认为内容脚本
    this.context = 'content';
    logger.debug('无法确定具体上下文，默认为内容脚本');
  }
  
  private setupListeners(): void {
    try {
      chrome.runtime.onMessage.addListener(this.handleIncomingMessage.bind(this));
    } catch (error) {
      logger.error('注册 onMessage 监听器失败:', error);
    }
  }
  
  private handleIncomingMessage(
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ): boolean {
    if (!message || !message.type) {
      return false;
    }
    
    if (message.target && message.target !== this.context) {
      return false;
    }
    
    const handlers = this.handlers.get(message.type);
    if (!handlers || handlers.length === 0) {
      logger.debug(`没有找到消息 "${message.type}" 的处理器`);
      return false;
    }
    
    let asyncResponse = false;
    
    Promise.all(handlers.map(async ({ handler, options }) => {
      try {
        const result = await Promise.resolve(handler(message, sender));
        
        if (options.once) {
          this.off(message.type, handler);
        }
        
        return result;
      } catch (error) {
        logger.error(`处理消息 "${message.type}" 时出错:`, error);
        throw error;
      }
    }))
    .then(results => {
      sendResponse(results[0]);
    })
    .catch(error => {
      sendResponse({ error: error.message });
    });
    
    return true;
  }
  
  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = new Promise<void>((resolve) => {
      try {
        this.setupListeners();
        this.initialized = true;
        logger.info('消息系统初始化完成');
        resolve();
      } catch (error) {
        logger.error('消息系统初始化失败:', error);
        this.initialized = true;
        resolve();
      }
    });
    
    return this.initPromise;
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && !this.initPromise) {
      await this.init();
    } else if (this.initPromise) {
      await this.initPromise;
    }
  }
  
  public async on<T = any, R = any>(
    type: string, 
    handler: MessageHandler<T, R>,
    options: MessageListenerOptions = {}
  ): Promise<() => void> {
    await this.ensureInitialized();

    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    
    const handlerEntry = { handler, options };
    this.handlers.get(type)!.push(handlerEntry);
    
    logger.debug(`已注册消息处理器: "${type}"`);
    
    return () => this.off(type, handler);
  }
  
  public async once<T = any, R = any>(
    type: string, 
    handler: MessageHandler<T, R>,
    options: MessageListenerOptions = {}
  ): Promise<() => void> {
    return this.on(type, handler, { ...options, once: true });
  }
  
  public async off(type: string, handler?: MessageHandler): Promise<void> {
    await this.ensureInitialized();

    if (!handler) {
      this.handlers.delete(type);
      logger.debug(`已移除所有 "${type}" 消息处理器`);
    } else {
      const handlers = this.handlers.get(type);
      if (handlers) {
        const index = handlers.findIndex(h => h.handler === handler);
        if (index !== -1) {
          handlers.splice(index, 1);
          logger.debug(`已移除一个 "${type}" 消息处理器`);
        }
        
        if (handlers.length === 0) {
          this.handlers.delete(type);
        }
      }
    }
  }
  
  public async send<T = any, R = any>(
    type: string, 
    payload?: T, 
    options: SendMessageOptions = {}
  ): Promise<R> {
    await this.ensureInitialized();

    const { tabId, timeout = 30000, target } = options;
    const message: Message<T> = {
      type,
      payload,
      id: nanoid(),
      source: this.context,
      target,
      timestamp: Date.now()
    };

    logger.debug(`发送消息: ${type}`, payload);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new MessageTimeoutError(type, timeout));
      }, timeout);
    });

    const sendPromise = new Promise<R>((resolve, reject) => {
      try {
        if (tabId) {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
            chrome.tabs.sendMessage(tabId, message, response => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response as R);
              }
            });
          } else {
            reject(new Error('chrome.tabs.sendMessage 不可用'));
          }
        } else {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage(message, response => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response as R);
              }
            });
          } else {
            reject(new Error('chrome.runtime.sendMessage 不可用'));
          }
        }
      } catch (error) {
        logger.error(`发送消息 "${type}" 失败:`, error);
        reject(error);
      }
    });

    return Promise.race([sendPromise, timeoutPromise]);
  }

  public async sendWithoutResponse<T = any>(
    type: string, 
    payload?: T, 
    options: SendMessageOptions = {}
  ): Promise<void> {
    await this.ensureInitialized();

    const { tabId, target } = options;
    const message: Message<T> = {
      type,
      payload,
      id: nanoid(),
      source: this.context,
      target,
      timestamp: Date.now()
    };

    logger.debug(`发送消息(无响应): ${type}`, payload);

    // 健壮性判断，防止 context invalidated
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      logger.warn('chrome.runtime.sendMessage 不可用，消息未发送', { type, payload });
      return;
    }

    try {
      if (tabId) {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(tabId, message);
        }
      } else {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(message);
        }
      }
    } catch (error) {
      logger.error(`发送消息 "${type}" 失败:`, error);
    }
  }
}

// 创建并导出单例实例
export const messenger = Messenger.getInstance();
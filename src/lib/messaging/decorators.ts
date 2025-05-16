import { Messenger } from './messenger.js';
import { Logger } from '../logger/logger.js'; 
import { 
  Message, 
  MessageSender, 
  MessageHandler, 
  MessageListenerOptions 
} from './message-types.js';

// 添加日志器
const logger = new Logger('MessageDecorators');

/**
 * 存储消息处理配置的元数据集合
 */
const MESSAGE_HANDLERS = Symbol('MESSAGE_HANDLERS');

/**
 * 消息处理器装饰器 - TypeScript 5.0+ 版本
 * 用于声明类方法作为特定消息类型的处理函数
 */
export function OnMessage(type: string, options: MessageListenerOptions = {}) {
  return function<This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>
  ) {
    // 获取方法名称
    const methodName = context.name.toString();
    
    // 在类初始化完成后执行
    context.addInitializer(function(this: any) {
      // 确保存在处理器集合
      if (!this[MESSAGE_HANDLERS]) {
        this[MESSAGE_HANDLERS] = [];
        
        // 注册所有处理器
        const messenger = Messenger.getInstance();
        
        // 使用queueMicrotask代替setTimeout，确保在当前事件循环结束前执行
        queueMicrotask(() => {
          try {
            if (this[MESSAGE_HANDLERS]) {
              logger.debug(`注册${this[MESSAGE_HANDLERS].length}个消息处理器`);
              
              this[MESSAGE_HANDLERS].forEach(({ type, methodName, options }: any) => {
                if (typeof this[methodName] === 'function') {
                  logger.debug(`注册消息处理器: ${type} -> ${methodName}`);
                  
                  messenger.on(
                    type,
                    async (message: Message, sender?: MessageSender) => {
                      try {
                        // 调用方法并返回可能的Promise结果
                        return await this[methodName](message, sender);
                      } catch (error) {
                        logger.error(`处理消息 ${type} 时出错:`, error);
                        throw error; // 重新抛出以便消息系统处理
                      }
                    },
                    options
                  );
                }
              });
            }
          } catch (error) {
            logger.error('注册消息处理器失败:', error);
          }
        });
      }
      
      // 添加当前方法到处理器集合
      this[MESSAGE_HANDLERS].push({
        type,
        methodName,
        options
      });
    });
    
    // 保持原方法不变
    return target;
  };
}

/**
 * 为了向后兼容，提供经典装饰器语法版本
 * 用于TypeScript 4.x或使用experimentalDecorators
 */
export function LegacyOnMessage(type: string, options: MessageListenerOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    // 确保类上有MESSAGE_HANDLERS集合
    if (!target.constructor[MESSAGE_HANDLERS]) {
      target.constructor[MESSAGE_HANDLERS] = [];
      
      // 扩展constructor以在实例化时注册处理器
      const originalConstructor = target.constructor;
      target.constructor = function(...args: any[]) {
        const instance = new originalConstructor(...args);
        
        // 注册所有消息处理器
        const messenger = Messenger.getInstance();
        target.constructor[MESSAGE_HANDLERS].forEach(
          ({ type, propertyKey, options }: any) => {
            if (typeof instance[propertyKey] === 'function') {
              messenger.on(
                type,
                (message: Message, sender?: MessageSender) => instance[propertyKey](message, sender),
                options
              );
            }
          }
        );
        
        return instance;
      };
      
      // 保留原型链和静态属性
      target.constructor.prototype = originalConstructor.prototype;
      Object.setPrototypeOf(target.constructor, originalConstructor);
    }
    
    // 添加当前方法到处理器集合
    target.constructor[MESSAGE_HANDLERS].push({
      type,
      propertyKey,
      options
    });
    
    return descriptor;
  };
}
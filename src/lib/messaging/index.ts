// 导出类型定义
export * from './message-types.js';

// 导出设置函数
export { setupMessageHandlers, registerModuleHandlers } from './setup.js';

// 仅导出核心类(高级用法)
export { Messenger } from './messenger.js';
export { MessageBus } from './message-bus.js';

// 导出装饰器
export { OnMessage } from './decorators.js';

// 导入实例(内部使用)
import { messageBus } from './message-bus.js';

/**
 * 发送消息并等待响应
 * @param type 消息类型
 * @param payload 消息负载
 * @param options 发送选项
 */
export function send<T = any, R = any>(
  type: string, 
  payload?: T, 
  options?: any
): Promise<R> {
  return messageBus.send(type, payload, options);
}

/**
 * 注册消息处理器
 * @param type 消息类型
 * @param handler 处理函数
 * @param options 监听选项
 */
export function on<T = any, R = any>(
  type: string, 
  handler: (message: any) => any, 
  options?: any
): Promise<() => void> {
  return messageBus.on(type, handler, options);
}

/**
 * 移除消息处理器
 * @param type 消息类型
 * @param handler 可选的特定处理函数
 */
export function off<T = any, R = any>(
    type: string, 
    handler?: (message: any, sender?: any) => any): void {
  return messageBus.off(type, handler);
}

/**
 * 注册一次性消息处理器
 * @param type 消息类型
 * @param handler 处理函数
 */
export function once<T = any, R = any>(
  type: string, 
  handler: (message: any) => any
): Promise<() => void> {
  return messageBus.once(type, handler);
}

/**
 * 发送本地事件(不跨上下文)
 * @param type 事件类型
 * @param data 事件数据
 */
export function emit(type: string, data?: any): void {
  return messageBus.emit(type, data);
}

// 导出默认实例 - 作为主要入口点
export default messageBus;

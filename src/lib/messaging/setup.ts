import { messenger } from './messenger.js';
import { Logger } from '../logger/logger.js';

const logger = new Logger('MessageSetup');

/**
 * 设置消息处理系统
 * - 注册全局处理器
 */
export async function setupMessageHandlers(): Promise<void> {
  try {
    // 注册全局消息处理器
    setupGlobalHandlers();  // 函数名保持一致
    
    logger.info('消息处理器设置完成');
  } catch (error) {
    logger.error('设置消息处理系统失败:', error);
    throw error;
  }
}

/**
 * 注册全局消息处理器
 */
function setupGlobalHandlers(): void {  // 修改函数名以匹配调用
  // 系统级消息处理
  messenger.on('PING', () => {
    return { pong: Date.now() };
  });
  
  messenger.on('GET_EXTENSION_VERSION', () => {
    return { version: chrome.runtime.getManifest().version };
  });
  
  // 根据需要可以添加更多...
}

/**
 * 注册特定模块的处理器
 * @param module 模块名称
 * @param handlers 处理函数映射
 * @returns 返回一个函数，调用时会注销所有处理器
 */
export async function registerModuleHandlers(
  module: string, 
  handlers: Record<string, Function>
): Promise<() => void> {
  // 收集所有取消订阅函数
  const unsubscribes: Array<() => void> = [];
  
  // 逐个注册处理器
  for (const [type, handler] of Object.entries(handlers)) {
    // 等待注册完成并获取取消订阅函数
    const unsubscribe = await messenger.on(`${module}:${type}`, (message) => {
      try {
        const result = handler(message.payload);
        return result instanceof Promise ? result : Promise.resolve(result);
      } catch (error) {
        logger.error(`处理消息 ${module}:${type} 时出错:`, error);
        return Promise.reject(error);
      }
    });
    
    unsubscribes.push(unsubscribe);
  }
  
  // 返回批量注销函数
  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
}
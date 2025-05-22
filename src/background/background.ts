/**
 * Chrome 扩展后台脚本
 * 
 * 此脚本负责初始化各个子系统和提供基本的扩展生命周期处理
 */

// 导入核心模块
import { Logger } from '../lib/logger/logger.js';
import { storage } from '../lib/storage/index.js';
import { i18n } from '../lib/i18n/i18n.js';
import { browserEvents } from '../lib/browser-events/index.js';
import { config } from '../lib/config/index.js';
// 修改消息系统导入方式 - 使用默认导出
import messageBus, { setupMessageHandlers } from '../lib/messaging/index.js';
import { registerBackgroundEventHandlers } from './event-handlers.js';

// 初始化日志系统（Logger 可能不需要显式初始化，创建实例即可）
const logger = new Logger('background');
logger.info('后台脚本启动');

/**
 * 初始化所有子系统
 */
async function initializeSubsystems() {
  try {
    // 1. 初始化国际化系统
    await i18n.init();
    logger.info('国际化系统已初始化');
    
    // 2. 初始化存储系统 (优先初始化，因为其他系统可能依赖它)
    await storage.init();
    logger.info('存储系统已初始化');
    
    // 3. 初始化配置系统 (依赖存储系统)
    await config.init();
    logger.info('配置系统已初始化');
    
    // 4. 初始化事件管理器
    await browserEvents.init();
    logger.info('浏览器事件系统已初始化');
    
    // 5. 初始化消息系统核心 (显式初始化)
    await messageBus.init();
    logger.info('消息系统已初始化');
    
    // 6. 设置消息处理器 (注册处理函数)
    await setupMessageHandlers();
    logger.info('消息处理器已配置完成');
    
    // 所有系统初始化完成
    logger.info('所有子系统初始化完成');
  } catch (error) {
    logger.error('初始化子系统失败:', error);
  }
}

// 注册所有 background 事件和消息监听
registerBackgroundEventHandlers();

// 启动初始化流程
initializeSubsystems().then(() => {
  logger.info('后台脚本初始化完成，扩展已准备就绪');
}).catch(error => {
  logger.error('扩展初始化失败:', error);
});
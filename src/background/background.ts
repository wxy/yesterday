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
import { registerMessageHandlers } from './message-handlers.js';
import { AIManager } from '../lib/ai/ai-manager.js';
import { tryHandleCrossDayTask } from './cross-day.js';
import { registerGlobalEventListeners } from './event-handlers.js';

let aiServiceAvailable = true;
let aiServiceStatus: Record<string, boolean> = {};

/**
 * 初始化所有子系统
 */
async function initializeSubsystems() {
  try {
    // 1. 初始化国际化系统（无依赖，最先初始化，默认语言）
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

    // 7. 注册所有本地 AI 服务（只在后台注册，解耦具体服务实现）
    await AIManager.registerAllBuiltInServices();
    logger.info('所有本地 AI 服务已注册');
    
    // 所有系统初始化完成
    logger.info('所有子系统初始化完成');
  } catch (error) {
    logger.error('初始化子系统失败:', error);
  }
}

async function updateGlobalConfig() {
  try {
    const allConfig = await config.getAll();
    globalConfig = allConfig || {};
    // 动态切换语言（如有变化）
    if (globalConfig.language && globalConfig.language !== 'auto') {
      await i18n.changeLanguage(globalConfig.language);
    }
  } catch {
    // 保持默认值
  }
}

// 初始化日志系统（Logger 可能不需要显式初始化，创建实例即可）
const logger = new Logger('background');
logger.info('后台脚本启动');

// ====== 全局配置缓存及监听 ======
export let globalConfig: any = {};
// 移除 crossDayIdleThresholdMs 变量，跨日清理任务应直接读取 config

// 启动时立即加载一次配置（含语言切换）
updateGlobalConfig();

// 监听配置变更，自动刷新全局配置和语言
config.onConfigChanged?.(updateGlobalConfig);

// 启动初始化流程
initializeSubsystems().then(() => {
  logger.info('后台脚本初始化完成，扩展已准备就绪');
  registerMessageHandlers();
  registerGlobalEventListeners();
  AIManager.checkAndNotifyStatus();
  // 启动时主动检测一次跨日，保证首次加载时不会漏掉
  tryHandleCrossDayTask();
}).catch(error => {
  logger.error('扩展初始化失败:', error);
});
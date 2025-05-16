import { Logger } from '../lib/logger/logger.js';
import { config } from '../lib/config/index.js';

const logger = new Logger('Options');

/**
 * 初始化选项页
 */
async function initializeOptionsPage() {
  try {
    logger.debug('初始化选项页');
    
    // 获取容器元素
    const container = document.querySelector('.container') as HTMLElement;
    if (!container) {
      throw new Error('未找到容器元素');
    }
    
    // 在容器中渲染配置UI
    await config.renderUI(container, {
      // 可选：自定义保存回调
      onSave: async () => {
        const values = document.querySelector('.container')!.getAttribute('data-values');
        logger.debug('保存选项', values ? JSON.parse(values) : 'No values');
        
        // 使用默认保存逻辑
        const formData = config['uiRenderer'].collectConfigValues();
        await config.update(formData);
      }
    });
    
    logger.debug('选项页初始化完成');
  } catch (error) {
    logger.error('初始化选项页失败', error);
  }
}

// 当DOM内容加载完成后初始化页面
document.addEventListener('DOMContentLoaded', initializeOptionsPage);
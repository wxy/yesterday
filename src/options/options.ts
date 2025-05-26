import { Logger } from '../lib/logger/logger.js';
import { config } from '../lib/config/index.js';
import { messenger } from '../lib/messaging/messenger.js';

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
    // 1. 读取 storage 配置，赋值给 window.currentConfig
    const allConfig = await config.getAll();
    (window as any).currentConfig = JSON.parse(JSON.stringify(allConfig));
    // 2. 渲染配置UI，保存时也刷新 window.currentConfig
    await config.renderUI(container, {
      onSave: async () => {
        const formData = config['uiRenderer'].collectConfigValues();
        await config.update(formData);
        // 保存后刷新 window.currentConfig，防止页面与 storage 脱节
        const latest = await config.getAll();
        (window as any).currentConfig = JSON.parse(JSON.stringify(latest));
        logger.debug('保存选项并刷新 currentConfig', latest);
      }
    });

    // 初始化侧面板选项
    await initSidePanelOption();
    // 初始化 AI 服务选择
    // await initAiServiceSelect(); // 旧的单独下拉框已废弃，统一用 config.renderUI 渲染
    
    logger.debug('选项页初始化完成');
  } catch (error) {
    logger.error('初始化选项页失败', error);
  }
}

/**
 * 初始化侧面板选项
 */
async function initSidePanelOption() {
  const checkbox = document.getElementById('useSidePanelOption') as HTMLInputElement;
  if (!checkbox) return;
  // 初始化状态
  const resp = await messenger.send('GET_USE_SIDE_PANEL');
  checkbox.checked = !!resp?.useSidePanel;
  // 变更时通知后台
  checkbox.addEventListener('change', async () => {
    await messenger.send('SET_USE_SIDE_PANEL', { useSidePanel: checkbox.checked });
  });
}

// 当DOM内容加载完成后初始化页面
document.addEventListener('DOMContentLoaded', initializeOptionsPage);
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
    const container = document.querySelector('.container') as HTMLElement;
    if (!container) {
      throw new Error('未找到容器元素');
    }
    // 读取 storage 配置，赋值给 window.currentConfig
    const allConfig = await config.getAll();
    (window as any).currentConfig = JSON.parse(JSON.stringify(allConfig));
    // 直接渲染所有配置项（包括语言选择）
    await config.renderUI(container, {
      onSave: async () => {
        const formData = config['uiRenderer'].collectConfigValues();
        await config.update(formData);
        const latest = await config.getAll();
        (window as any).currentConfig = JSON.parse(JSON.stringify(latest));
        logger.debug('保存选项并刷新 currentConfig', latest);
      }
    } as any);
    logger.debug('选项页初始化完成');
  } catch (error) {
    logger.error('初始化选项页失败', error);
  }
}

// 检查 AI 服务可用性并禁用不可用服务
async function disableUnavailableAiServices() {
  try {
    const result = await messenger.send('CHECK_AI_SERVICES');
    if (result && result.details) {
      for (const [id, available] of Object.entries(result.details)) {
        // 假设每个服务相关控件有 data-ai-service-id 属性
        const row = document.querySelector(`[data-ai-service-id="${id}"]`);
        if (row) {
          row.classList.toggle('ai-service-unavailable-row', !available);
          // 禁用所有输入控件
          row.querySelectorAll('input,select,textarea,button').forEach(el => {
            (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement).disabled = !available;
          });
        }
      }
    }
  } catch (e) {
    // 忽略异常
  }
}

// 配置变更自动刷新 UI
config.onConfigChanged(() => {
  if (typeof initializeOptionsPage === 'function') {
    initializeOptionsPage();
  }
});

// 监听 AI_SERVICE_UNAVAILABLE 消息
messenger.on('AI_SERVICE_UNAVAILABLE', (msg) => {
  let text = '未检测到可用的本地 AI 服务，AI 分析功能已禁用。';
  const details = msg.payload?.details as Record<string, boolean> | undefined;
  if (details) {
    const detailArr = Object.entries(details).map(([k, v]) => `${k}: ${v ? '可用' : '不可用'}`);
    text += '\n' + detailArr.join('，');
  }
  let aiWarn = document.querySelector('.ai-service-unavailable');
  if (!aiWarn) {
    aiWarn = document.createElement('div');
    aiWarn.className = 'ai-service-unavailable';
    document.body.prepend(aiWarn);
  }
  aiWarn.textContent = text;
  // 标记服务不可用
  if (details) {
    for (const [id, available] of Object.entries(details)) {
      const row = document.querySelector(`[data-ai-service-id="${id}"]`);
      if (row) {
        row.classList.toggle('ai-service-unavailable-row', !available);
      }
    }
  }
});

// 当DOM内容加载完成后初始化页面
document.addEventListener('DOMContentLoaded', () => {
  initializeOptionsPage();
  disableUnavailableAiServices();
});
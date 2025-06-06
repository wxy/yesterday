import { Logger } from '../lib/logger/logger.js';
import { config } from '../lib/config/index.js';
import { getConfigUIMetadata } from '../lib/config/config-utils.js';
import { messenger } from '../lib/messaging/messenger.js';
import { i18n } from '../lib/i18n/i18n.js';

const logger = new Logger('Options');

/**
 * 初始化选项页
 */
async function initializeOptionsPage() {
  try {
    const container = document.querySelector('.container') as HTMLElement;
    if (!container) {
      throw new Error('未找到容器元素');
    }
    // 读取 storage 配置，赋值给 window.currentConfig
    const allConfig = await config.getAll();
    (window as any).currentConfig = JSON.parse(JSON.stringify(allConfig));
    //await I18n.getInstance().init();
    const uiMeta = getConfigUIMetadata();
    await config.renderUI(container, {
      uiMetadata: uiMeta,
      onSave: async () => {
        const formData = config['uiRenderer'].collectConfigValues();
        const prevConfig = await config.getAll();
        await config.update(formData);
        const latest = await config.getAll();
        // 判断语言是否变化
        if (prevConfig.language !== latest.language) {
          let targetLang = latest.language;
          if (!targetLang || targetLang === 'auto') {
            // 跟随浏览器
            targetLang = (navigator.language || 'en').replace('-', '_');
          }
          await i18n.changeLanguage(targetLang);
          await i18n.apply();
          // 重新渲染配置UI，确保所有 label/description/option.label 都用新语言
          initializeOptionsPage();
          return;
        }
        // 其它配置变更可选刷新UI（如有需要可手动刷新）
      }
    } as any);
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
document.addEventListener('DOMContentLoaded', async () => {
  const allConfig = await config.getAll();
  let targetLang = allConfig.language;
  if (!targetLang || targetLang === 'auto') {
    targetLang = i18n.getAutoLanguage();
  }
  await i18n.changeLanguage(targetLang);
  await i18n.apply();
  initializeOptionsPage();
  disableUnavailableAiServices();
});
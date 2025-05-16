import { Logger } from '../lib/logger/logger.js';
import { storage } from '../lib/storage/index.js';
import { i18n } from '../lib/i18n/i18n.js';
import { messenger } from '../lib/messaging/messenger.js';

const logger = new Logger('Popup');

// 元素引用
const statusValueEl = document.getElementById('statusValue') as HTMLElement;
const lastSyncValueEl = document.getElementById('lastSyncValue') as HTMLElement;
const storageUsageValueEl = document.getElementById('storageUsageValue') as HTMLElement;
const actionButton = document.getElementById('actionButton') as HTMLButtonElement;
const syncButton = document.getElementById('syncButton') as HTMLButtonElement;
const clearDataButton = document.getElementById('clearDataButton') as HTMLButtonElement;
const openOptionsLink = document.getElementById('openOptions') as HTMLAnchorElement;
const openHelpLink = document.getElementById('openHelp') as HTMLAnchorElement;
const versionInfoEl = document.getElementById('versionInfo') as HTMLElement;

// 加载当前状态
async function loadStatus() {
  try {
    logger.debug('正在加载扩展状态');
    
    // 获取存储使用情况
    const usage = await chrome.storage.local.getBytesInUse(null);
    const usageFormatted = formatBytes(usage);
    storageUsageValueEl.textContent = usageFormatted;
    
    // 获取上次同步时间
    const lastSyncData = await storage.get('lastSync');
    if (lastSyncData) {
      const lastSyncDate = new Date(lastSyncData as number);
      lastSyncValueEl.textContent = lastSyncDate.toLocaleString();
    }
    
    // 获取版本
    const manifest = chrome.runtime.getManifest();
    versionInfoEl.textContent = `版本：${manifest.version}`;
    
    // 检查扩展状态
    const status = await messenger.send('getStatus');
    statusValueEl.textContent = status ? status : '正常';
    if (status === 'error') {
      statusValueEl.style.color = '#d93025';
    }
    
    logger.debug('状态加载完成');
  } catch (error) {
    logger.error('加载状态失败', error);
    statusValueEl.textContent = '加载失败';
    statusValueEl.style.color = '#d93025';
  }
}

// 格式化字节数
function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 执行主要操作
async function performAction() {
  try {
    logger.info('执行主要操作');
    actionButton.disabled = true;
    actionButton.textContent = '处理中...';
    
    // 模拟操作延迟
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 向后台发送操作请求
    const result = await messenger.send('performAction', { timestamp: Date.now() });
    logger.debug('操作结果', result);
    
    // 更新UI反馈
    actionButton.textContent = '操作成功！';
    setTimeout(() => {
      actionButton.textContent = '执行操作';
      actionButton.disabled = false;
    }, 1500);
    
    // 刷新状态
    await loadStatus();
  } catch (error) {
    logger.error('执行操作失败', error);
    actionButton.textContent = '操作失败';
    setTimeout(() => {
      actionButton.textContent = '执行操作';
      actionButton.disabled = false;
    }, 1500);
  }
}

// 同步数据
async function syncData() {
  try {
    logger.info('开始同步数据');
    syncButton.disabled = true;
    syncButton.textContent = '同步中...';
    
    // 调用同步方法
    await messenger.send('syncData');
    
    // 更新最后同步时间
    await storage.set('lastSync', Date.now());
    
    // 更新UI
    syncButton.textContent = '同步成功！';
    setTimeout(() => {
      syncButton.textContent = '立即同步';
      syncButton.disabled = false;
    }, 1500);
    
    // 刷新状态
    await loadStatus();
  } catch (error) {
    logger.error('同步失败', error);
    syncButton.textContent = '同步失败';
    setTimeout(() => {
      syncButton.textContent = '立即同步';
      syncButton.disabled = false;
    }, 1500);
  }
}

// 清除数据
async function clearData() {
  if (confirm('确定要清除所有本地数据吗？此操作无法撤销。')) {
    try {
      logger.info('清除本地数据');
      clearDataButton.disabled = true;
      
      // 清除存储数据
      await storage.clear();
      
      // 通知后台
      await messenger.send('dataCleared');
      
      // 更新UI
      clearDataButton.textContent = '已清除';
      setTimeout(() => {
        clearDataButton.textContent = '清除数据';
        clearDataButton.disabled = false;
      }, 1500);
      
      // 刷新状态
      await loadStatus();
    } catch (error) {
      logger.error('清除数据失败', error);
      clearDataButton.textContent = '清除失败';
      setTimeout(() => {
        clearDataButton.textContent = '清除数据';
        clearDataButton.disabled = false;
      }, 1500);
    }
  }
}

// 打开选项页
function openOptions() {
  chrome.runtime.openOptionsPage();
}

// 打开帮助页面
function openHelp() {
  chrome.tabs.create({ url: 'https://github.com/yourusername/your-extension/wiki' });
}

// 初始化弹出窗口
async function initPopup() {
  try {
    // 设置国际化
    document.title = i18n.getMessage('popupTitle') || '扩展弹出窗口';
    
    // 加载状态
    await loadStatus();
    
    // 添加事件监听器
    actionButton.addEventListener('click', performAction);
    syncButton.addEventListener('click', syncData);
    clearDataButton.addEventListener('click', clearData);
    openOptionsLink.addEventListener('click', openOptions);
    openHelpLink.addEventListener('click', openHelp);
    
    logger.debug('弹出窗口初始化完成');
  } catch (error) {
    logger.error('初始化弹出窗口失败', error);
  }
}

// 当DOM内容加载完成后初始化页面
document.addEventListener('DOMContentLoaded', initPopup);
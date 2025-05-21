import { Logger } from '../lib/logger/logger.js';
import { storage } from '../lib/storage/index.js';
import { i18n } from '../lib/i18n/i18n.js';
import { messenger } from '../lib/messaging/messenger.js';
import '../lib/ai/ollama-service.js';

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

// 新增：显示访问数据按钮和展示区域
const showTodayVisitsBtn = document.getElementById('showTodayVisitsBtn') as HTMLButtonElement;
const showYesterdayVisitsBtn = document.getElementById('showYesterdayVisitsBtn') as HTMLButtonElement;
const visitsRawData = document.getElementById('visitsRawData') as HTMLElement;
const aiAnalysisRawData = document.getElementById('aiAnalysisRawData') as HTMLElement;

function getDayId(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function getVisits(dayId: string) {
  try {
    // 兼容你的消息系统，payload 作为第二参数
    const resp = await messenger.send('GET_VISITS', { dayId });
    return resp && resp.visits ? resp.visits : [];
  } catch (e) {
    logger.error('获取访问数据失败', e);
    return [];
  }
}

async function getAiAnalysis(dayId: string) {
  try {
    // 兼容你的消息系统，payload 作为第二参数
    const key = `ai_analysis_${dayId}`;
    // 直接用 storage.get 也可，但保持一致用 messenger
    const resp = await messenger.send('GET_AI_ANALYSIS', { dayId });
    return resp && resp.analysis ? resp.analysis : [];
  } catch (e) {
    logger.error('获取AI分析结果失败', e);
    return [];
  }
}

// 重写按钮事件，合并展示
showTodayVisitsBtn.addEventListener('click', async () => {
  const dayId = getDayId(0);
  visitsRawData.textContent = '加载中...';
  aiAnalysisRawData.textContent = '加载中...';
  const [visits, analysis] = await Promise.all([
    getVisits(dayId),
    getAiAnalysis(dayId)
  ]);
  visitsRawData.textContent = JSON.stringify(visits, null, 2) || '无数据';
  aiAnalysisRawData.textContent = JSON.stringify(analysis, null, 2) || '无数据';
});

showYesterdayVisitsBtn.addEventListener('click', async () => {
  const dayId = getDayId(-1);
  visitsRawData.textContent = '加载中...';
  aiAnalysisRawData.textContent = '加载中...';
  const [visits, analysis] = await Promise.all([
    getVisits(dayId),
    getAiAnalysis(dayId)
  ]);
  visitsRawData.textContent = JSON.stringify(visits, null, 2) || '无数据';
  aiAnalysisRawData.textContent = JSON.stringify(analysis, null, 2) || '无数据';
});

// 统计存储用量（简单统计所有键值的序列化长度总和）
async function getStorageUsage() {
  try {
    const keys = await storage.keys();
    if (!keys.length) return 0;
    const all = await storage.getMany(keys);
    let total = 0;
    for (const v of Object.values(all)) {
      if (typeof v === 'string') {
        total += v.length;
      } else if (typeof v === 'object' && v !== null) {
        total += JSON.stringify(v).length;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

// 加载当前状态
async function loadStatus() {
  try {
    logger.debug('正在加载扩展状态');
    // 获取存储使用情况
    const usage = await getStorageUsage();
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
    // 检查扩展状态（用自定义消息系统）
    let status = '正常';
    try {
      const statusResp = await messenger.send('getStatus');
      if (statusResp && statusResp.status) status = statusResp.status;
    } catch {}
    statusValueEl.textContent = status;
    if (status === 'error') {
      statusValueEl.style.color = '#d93025';
    }
    logger.debug('状态加载完成');
  } catch (error) {
    logger.error('加载状态失败', error);
    statusValueEl.textContent = '加载失败';
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
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

// ====== AI 对话测试区域事件绑定 ======
document.addEventListener('DOMContentLoaded', () => {
  const aiTestBtn = document.getElementById('aiTestBtn') as HTMLButtonElement;
  const aiTestInput = document.getElementById('aiTestInput') as HTMLTextAreaElement;
  const aiTestResult = document.getElementById('aiTestResult') as HTMLElement;

  if (aiTestBtn && aiTestInput && aiTestResult) {
    aiTestBtn.addEventListener('click', async () => {
      aiTestBtn.disabled = true;
      aiTestBtn.textContent = '请求中...';
      aiTestResult.textContent = '';
      try {
        const userInput = aiTestInput.value.trim();
        if (!userInput) {
          aiTestResult.textContent = '请输入内容';
          return;
        }
        // 通过后台代理 AI 请求
        const resp = await messenger.send('AI_CHAT_REQUEST', {
          __aiProxy: true,
          messages: [
            { role: 'user', content: userInput }
          ]
        });
        if (resp.success) {
          aiTestResult.textContent = resp.data.text || '[无返回内容]';
        } else {
          let msg = resp.error || '[请求失败]';
          if (resp.fullResponse) {
            msg += '\n--- 响应内容 ---\n' + resp.fullResponse;
          }
          aiTestResult.textContent = '请求失败：' + msg;
        }
      } catch (e: any) {
        let msg = e?.message || e;
        if (e && typeof e === 'object' && (e.fullResponse || e.responseText)) {
          msg += '\n--- 响应内容 ---\n' + (e.fullResponse || e.responseText);
        }
        aiTestResult.textContent = '请求失败：' + msg;
      } finally {
        aiTestBtn.disabled = false;
        aiTestBtn.textContent = 'AI 对话测试';
      }
    });
  }
});

// 初始化弹出窗口
async function initPopup() {
  try {
    // 初始化本地化（异步，不阻塞主流程）
    i18n.init();

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
    showTodayVisitsBtn.addEventListener('click', async () => {
      const dayId = getDayId(0);
      visitsRawData.textContent = '加载中...';
      aiAnalysisRawData.textContent = '加载中...';
      const [visits, analysis] = await Promise.all([
        getVisits(dayId),
        getAiAnalysis(dayId)
      ]);
      visitsRawData.textContent = JSON.stringify(visits, null, 2) || '无数据';
      aiAnalysisRawData.textContent = JSON.stringify(analysis, null, 2) || '无数据';
    });
    showYesterdayVisitsBtn.addEventListener('click', async () => {
      const dayId = getDayId(-1);
      visitsRawData.textContent = '加载中...';
      aiAnalysisRawData.textContent = '加载中...';
      const [visits, analysis] = await Promise.all([
        getVisits(dayId),
        getAiAnalysis(dayId)
      ]);
      visitsRawData.textContent = JSON.stringify(visits, null, 2) || '无数据';
      aiAnalysisRawData.textContent = JSON.stringify(analysis, null, 2) || '无数据';
    });

    logger.debug('弹出窗口初始化完成');
  } catch (error) {
    logger.error('初始化弹出窗口失败', error);
  }
}

// 当DOM内容加载完成后初始化页面
document.addEventListener('DOMContentLoaded', initPopup);
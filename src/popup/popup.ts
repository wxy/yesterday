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

// 合并访问数据和分析结果为一组，按时间排序
function mergeVisitsAndAnalysis(visits: any[], analysis: any[]) {
  // 用 url+title 做粗略关联（如有更精确的唯一标识可替换）
  const analysisMap = new Map<string, any>();
  for (const a of analysis) {
    const key = `${a.url}||${a.title}`;
    analysisMap.set(key, a);
  }
  return visits.map(v => {
    const key = `${v.url}||${v.title}`;
    return {
      ...v,
      aiResult: analysisMap.get(key)?.aiResult || '',
      analyzeDuration: analysisMap.get(key)?.analyzeDuration || 0,
      aiJson: analysisMap.get(key)?.aiJson || null
    };
  });
}

// 新增：合并展示区域
const mergedDataArea = document.getElementById('mergedDataArea') as HTMLElement;

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

function showAnalyzeDuration(analyzeDuration: number) {
  if (typeof analyzeDuration !== 'number' || analyzeDuration <= 0) return '';
  return `<span style='color:#888;font-size:11px;'>(分析用时 ${(analyzeDuration / 1000).toFixed(1)} 秒)</span>`;
}

// 默认加载今日数据
window.addEventListener('DOMContentLoaded', async () => {
  await showMergedData(getDayId(0));
});

async function showMergedData(dayId: string) {
  mergedDataArea.innerHTML = '<div style="color:#888;padding:8px;">加载中...</div>';
  const [visits, analysis] = await Promise.all([
    getVisits(dayId),
    getAiAnalysis(dayId)
  ]);
  let merged = mergeVisitsAndAnalysis(visits, analysis);
  // 倒序显示（最新在前）
  merged = merged.slice().sort((a, b) => (b.visitStartTime || 0) - (a.visitStartTime || 0));
  if (!merged.length) {
    mergedDataArea.innerHTML = '<div style="color:#888;padding:8px;">无数据</div>';
    return;
  }
  mergedDataArea.innerHTML = merged.map((item, idx) => {
    const collapsed = idx > 0;
    const entryId = `merged-entry-${idx}`;
    let aiContent = '';
    let durationStr = '';
    const shouldNotify = item.aiJson && typeof item.aiJson === 'object' && item.aiJson.shouldNotify === true;
    // 结构化内容友好排版，支持 key 大小写和别名，且仅有内容时才显示
    let isStructured = false;
    let rawText = item.aiResult;
    let jsonObj = item.aiJson && typeof item.aiJson === 'object' && !Array.isArray(item.aiJson) ? item.aiJson : null;
    // 如果 aiJson 不存在但 aiResult 是 JSON 字符串，也尝试 parse（增强容错，支持无引号、单引号、末尾逗号、属性值为数组等）
    if (!jsonObj && rawText && typeof rawText === 'string' && rawText.trim().startsWith('{')) {
      try {
        let tryText = rawText
          .replace(/\n/g, '')
          .replace(/\r/g, '')
          .replace(/\s+/g, ' ')
          .replace(/([,{])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // 属性名加引号
          .replace(/'/g, '"') // 单引号转双引号
          .replace(/,\s*}/g, '}') // 末尾逗号
          .replace(/,\s*]/g, ']');
        jsonObj = JSON.parse(tryText);
      } catch {}
    }
    if (jsonObj) {
      // key 兼容处理
      const keyMap = (obj: any) => {
        const map: Record<string, string> = {
          summary: '摘要',
          highlights: '亮点',
          points: '要点',
          suggestion: '建议',
        };
        const result: Record<string, any> = {};
        for (const k in obj) {
          const lower = k.toLowerCase();
          if (lower in map) {
            result[map[lower]] = obj[k];
          }
        }
        return result;
      };
      const mapped = keyMap(jsonObj);
      let hasContent = false;
      for (const label of ['摘要', '亮点', '要点', '建议']) {
        const val = mapped[label];
        if (label === '要点' && Array.isArray(val) && val.some((p: any) => typeof p === 'string' && p.trim())) {
          aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b><ul style='margin:4px 0 4px 18px;'>${val.filter((p: any) => typeof p === 'string' && p.trim()).map((p: any) => `<li>${p}</li>`).join('')}</ul></div>`;
          hasContent = true;
        } else if (label === '亮点' && Array.isArray(val) && val.some((p: any) => typeof p === 'string' && p.trim())) {
          aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b><ul style='margin:4px 0 4px 18px;'>${val.filter((p: any) => typeof p === 'string' && p.trim()).map((p: any) => `<li>${p}</li>`).join('')}</ul></div>`;
          hasContent = true;
        } else if (typeof val === 'string' && val.trim()) {
          aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b>${val}</div>`;
          hasContent = true;
        } else if (typeof val === 'number' && String(val).trim()) {
          aiContent += `<div style='margin-bottom:6px;'><b>${label}：</b>${val}</div>`;
          hasContent = true;
        }
      }
      if (hasContent) {
        isStructured = true;
      }
    }
    if (!isStructured) {
      // 非结构化或解析失败，直接显示原始文本，样式区分
      if (item.aiResult && item.aiResult.startsWith('AI 分析失败')) {
        aiContent = `<span style='color:#e53935;'>${item.aiResult.replace(/\n/g, '<br>')}</span>`;
      } else if (item.aiResult && item.aiResult !== '正在进行 AI 分析' && item.aiResult !== '') {
        aiContent = `<div style='color:#888;background:#f7f7fa;border-radius:4px;padding:6px 8px;'>${item.aiResult.replace(/\n/g, '<br>')}</div>`;
      } else if (item.aiResult === '正在进行 AI 分析' || item.aiResult === '') {
        aiContent = `<span style='color:#1a73e8;'>正在进行 AI 分析</span>`;
      } else {
        aiContent = `<span style='color:#aaa;'>[无分析结果]</span>`;
      }
    }
    if (item.analyzeDuration && item.analyzeDuration > 0) {
      durationStr = showAnalyzeDuration(item.analyzeDuration);
    }
    const cardStyle = [
      'border:2px solid',
      shouldNotify ? '#e53935' : '#e0e4ea', ';',
      'border-radius:6px;padding:8px 10px;margin-bottom:8px;',
      'background:',
      shouldNotify ? 'linear-gradient(90deg,#fff3f0 0%,#ffeaea 100%)' : '#fff', ';',
      'box-shadow:0 1px 2px 0 #f2f3f5;'
    ].join(' ');
    const titleLine = `<div style='font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;display:inline-block;vertical-align:middle;'>${item.title || ''}</div>`;
    const timeLine = `<div style='display:flex;justify-content:space-between;align-items:center;color:#888;font-size:12px;margin-top:2px;'>
      <span>${item.visitStartTime ? new Date(item.visitStartTime).toLocaleString() : ''}</span>
      <span>${durationStr}</span>
    </div>`;
    const urlLine = `<div style='color:#1a73e8;font-size:12px;word-break:break-all;margin-top:2px;'>${item.url || ''}</div>`;
    return `
      <div style='${cardStyle}'>
        <div class='merged-card-header' data-entry-id='${entryId}' style='cursor:pointer;display:flex;align-items:center;'>
          <span style='font-weight:bold;margin-right:8px;'>#${idx + 1}</span>
          ${titleLine}
        </div>
        <div id='${entryId}' style='${collapsed ? 'display:none;' : ''}margin-top:6px;'>
          ${timeLine}
          ${urlLine}
          <div style='margin-top:4px;'>${aiContent}</div>
        </div>
      </div>
    `;
  }).join('');

  // 事件委托：安全处理折叠/展开
  mergedDataArea.onclick = function(e) {
    const target = e.target as HTMLElement;
    const header = target.closest('.merged-card-header') as HTMLElement;
    if (header && header.dataset.entryId) {
      const entryId = header.dataset.entryId;
      const contentBox = document.getElementById(entryId);
      if (contentBox) {
        const isCollapsed = contentBox.style.display === 'none';
        contentBox.style.display = isCollapsed ? 'block' : 'none';
      }
    }
  };
}

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
clearDataButton.addEventListener('click', async () => {
  if (confirm('确定要清除所有本地数据吗？此操作无法撤销。')) {
    await clearData();
  }
});

async function clearData() {
  try {
    logger.info('清除本地数据');
    clearDataButton.disabled = true;
    // 清除存储数据
    await storage.clear();
    // 通知后台
    await messenger.send('dataCleared');
    // 清空展示区域
    mergedDataArea.innerHTML = '<div style="color:#888;padding:8px;">无数据</div>';
    // 刷新状态
    await loadStatus();
    clearDataButton.textContent = '已清除';
    setTimeout(() => {
      clearDataButton.textContent = '清除数据';
      clearDataButton.disabled = false;
    }, 1500);
  } catch (error) {
    logger.error('清除数据失败', error);
    clearDataButton.textContent = '清除失败';
    setTimeout(() => {
      clearDataButton.textContent = '清除数据';
      clearDataButton.disabled = false;
    }, 1500);
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
  // 打开弹窗时自动清除图标状态（已迁移为 messenger.send）
  messenger.send('CLEAR_ICON_STATUS');

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
    clearDataButton.addEventListener('click', async () => {
      if (confirm('确定要清除所有本地数据吗？此操作无法撤销。')) {
        await clearData();
      }
    });
    openOptionsLink.addEventListener('click', openOptions);
    openHelpLink.addEventListener('click', openHelp);
    showTodayVisitsBtn.addEventListener('click', async () => {
      const dayId = getDayId(0);
      await showMergedData(dayId);
    });
    showYesterdayVisitsBtn.addEventListener('click', async () => {
      const dayId = getDayId(-1);
      await showMergedData(dayId);
    });

    logger.debug('弹出窗口初始化完成');
  } catch (error) {
    logger.error('初始化弹出窗口失败', error);
  }
}

// 当DOM内容加载完成后初始化页面
document.addEventListener('DOMContentLoaded', initPopup);
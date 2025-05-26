import { Logger } from '../lib/logger/logger.js';
import { messenger } from '../lib/messaging/messenger.js';
import { storage } from '../lib/storage/index.js';

const logger = new Logger('Sidebar');

// AI服务配置缓存
let aiConfigCache: { value: any, ts: number } | null = null;
const AI_CONFIG_CACHE_TTL = 60 * 1000; // 1分钟

function showAnalyzeDuration(analyzeDuration: number) {
  if (typeof analyzeDuration !== 'number' || analyzeDuration <= 0) return '';
  return `<span style='color:#888;font-size:11px;'>(分析用时 ${(analyzeDuration / 1000).toFixed(1)} 秒)</span>`;
}

function mergeVisitsAndAnalysis(visits: any[], analysis: any[]) {
  // 先用 id 建立映射
  const analysisById = new Map<string, any>();
  const analysisByUrlTime = new Map<string, any>();
  for (const a of analysis) {
    if (a.id) analysisById.set(a.id, a);
    if (a.url && a.visitStartTime) analysisByUrlTime.set(`${a.url}||${a.visitStartTime}`, a);
  }
  return visits.map(v => {
    let matchedAnalysis = null;
    if (v.id && analysisById.has(v.id)) {
      matchedAnalysis = analysisById.get(v.id);
    } else if (v.url && v.visitStartTime && analysisByUrlTime.has(`${v.url}||${v.visitStartTime}`)) {
      matchedAnalysis = analysisByUrlTime.get(`${v.url}||${v.visitStartTime}`);
    }
    return {
      ...v,
      aiResult: matchedAnalysis?.aiResult || '',
      analyzeDuration: matchedAnalysis?.analyzeDuration || 0,
      aiJson: matchedAnalysis?.aiJson || null
    };
  });
}

// 获取当前 AI 服务名称（带缓存）
async function getCurrentAiServiceLabel(): Promise<string> {
  const now = Date.now();
  if (aiConfigCache && (now - aiConfigCache.ts < AI_CONFIG_CACHE_TTL)) {
    const serviceId = aiConfigCache.value?.serviceId || 'ollama';
    const labelMap: Record<string, string> = {
      'ollama': 'Ollama 本地',
      'chrome-ai': 'Chrome 内置 AI',
      'openai': 'OpenAI',
      'other': '其它',
    };
    return labelMap[serviceId] || serviceId;
  }
  try {
    // 通过 messenger 请求后台当前 AI 配置
    const resp = await messenger.send('GET_CONFIG', { key: 'aiServiceConfig' });
    aiConfigCache = { value: resp?.value, ts: now };
    const serviceId = resp?.value?.serviceId || 'ollama';
    // 本地映射
    const labelMap: Record<string, string> = {
      'ollama': 'Ollama 本地',
      'chrome-ai': 'Chrome 内置 AI',
      'openai': 'OpenAI',
      'other': '其它',
    };
    return labelMap[serviceId] || serviceId;
  } catch {
    return 'AI';
  }
}

async function renderMergedView(root: HTMLElement, dayId: string) {
  root.innerHTML = '<div style="color:#888;padding:16px;">加载中...</div>';
  const [visits, analysis] = await Promise.all([
    messenger.send('GET_VISITS', { dayId }).then(r => r?.visits || []).catch(() => []),
    messenger.send('GET_AI_ANALYSIS', { dayId }).then(r => r?.analysis || []).catch(() => [])
  ]);
  let merged = mergeVisitsAndAnalysis(visits, analysis);
  merged = merged.slice().sort((a, b) => (b.visitStartTime || 0) - (a.visitStartTime || 0));
  if (!merged.length) {
    root.innerHTML = '<div style="color:#888;padding:16px;">无数据</div>';
    return;
  }
  root.innerHTML = merged.map((item, idx) => {
    const collapsed = idx > 0;
    const entryId = `merged-entry-${idx}`;
    let aiContent = '';
    let durationStr = '';
    let isStructured = false;
    let rawText = item.aiResult;
    let jsonObj: any = null;
    // 新增：支持 aiResult 为结构化 JSON 或字符串
    if (rawText && typeof rawText === 'string' && rawText.trim().startsWith('{')) {
      try {
        jsonObj = JSON.parse(rawText);
        isStructured = true;
      } catch {}
    } else if (rawText && typeof rawText === 'object') {
      jsonObj = rawText;
      isStructured = true;
    }
    if (isStructured && jsonObj) {
      // summary
      aiContent = `<div style='font-weight:bold;margin-bottom:4px;'>${jsonObj.summary || ''}</div>`;
      // highlights
      if (jsonObj.highlights && Array.isArray(jsonObj.highlights) && jsonObj.highlights.length) {
        aiContent += `<ul style='margin:4px 0 4px 16px;padding:0;color:#333;font-size:13px;'>${jsonObj.highlights.map((h: string) => `<li>${h}</li>`).join('')}</ul>`;
      }
      // specialConcerns
      if (jsonObj.specialConcerns && Array.isArray(jsonObj.specialConcerns) && jsonObj.specialConcerns.length) {
        aiContent += `<div style='color:#e53935;font-size:13px;margin:4px 0;'>特别关注：${jsonObj.specialConcerns.map((c: string) => c).join('，')}</div>`;
      }
      // 卡片样式高亮由 important 字段控制，不再直接输出“重要性”文字
    } else if (typeof rawText === 'string') {
      // 兼容老逻辑，仅字符串时才做字符串判断
      if (rawText && rawText !== '正在进行 AI 分析' && rawText !== '') {
        // 新增：AI 分析失败高亮
        if (rawText.startsWith('AI 分析失败')) {
          aiContent = `<div style='color:#e53935;background:#fff3f3;border-radius:4px;padding:6px 8px;'>${rawText.replace(/\n/g, '<br>')}</div>`;
        } else {
          aiContent = `<div style='color:#888;background:#f7f7fa;border-radius:4px;padding:6px 8px;'>${rawText.replace(/\n/g, '<br>')}</div>`;
        }
      } else if ((rawText === '正在进行 AI 分析' || rawText === '') && !isStructured) {
        // 只有没有分析结果时才显示分析中
        const analyzingId = `analyzing-timer-${idx}`;
        aiContent = `<span style='color:#1a73e8;' id='${analyzingId}'>正在进行 AI 分析</span>`;
        setTimeout(() => {
          const el = document.getElementById(analyzingId);
          if (el && item.visitStartTime) {
            let timer: any = undefined;
            const updateText = () => {
              // 若分析结果已变为失败，立即高亮显示并终止动画
              const currentItem = merged[idx];
              if (currentItem && typeof currentItem.aiResult === 'string' && currentItem.aiResult.startsWith('AI 分析失败')) {
                el.textContent = currentItem.aiResult;
                el.style.color = '#e53935';
                el.style.background = '#fff3f3';
                el.style.borderRadius = '4px';
                el.style.padding = '6px 8px';
                if (timer !== undefined) clearInterval(timer);
                return;
              }
              const now = Date.now();
              const seconds = Math.floor((now - item.visitStartTime) / 1000);
              if (seconds >= 60) {
                el.textContent = `分析超时（已用时 ${seconds} 秒）`;
                el.style.color = '#e53935';
                if (timer !== undefined) clearInterval(timer);
                return;
              }
              el.textContent = `正在进行 AI 分析（已用时 ${seconds} 秒）`;
            };
            updateText();
            timer = setInterval(() => {
              if (!document.body.contains(el)) { if (timer !== undefined) clearInterval(timer); return; }
              updateText();
            }, 1000);
          }
        }, 0);
      } else {
        aiContent = `<span style='color:#aaa;'>[无分析结果]</span>`;
      }
    } else {
      aiContent = `<span style='color:#aaa;'>[无分析结果]</span>`;
    }
    if (item.analyzeDuration && item.analyzeDuration > 0) {
      durationStr = showAnalyzeDuration(item.analyzeDuration);
    }
    // 卡片样式高亮
    const isImportant = (item.aiResult && typeof item.aiResult === 'object' && item.aiResult.important === true);
    const cardStyle = [
      'border:2px solid',
      isImportant ? '#FFC10A' : '#e0e4ea', ';',
      'border-radius:6px;padding:8px 10px;margin-bottom:8px;',
      'background:',
      isImportant ? 'linear-gradient(90deg,#f8f0a9 0%,#FFEB3B 100%)' : '#fff', ';',
      'box-shadow:0 1px 2px 0 #f2f3f5;'
    ].join(' ');
    const visitTime = item.visitStartTime ? new Date(item.visitStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const titleLine = `<div style='display:flex;justify-content:space-between;align-items:center;'>
      <div style='font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;'>${item.title || ''}</div>
      <div style='color:#888;font-size:12px;margin-left:8px;flex-shrink:0;'>${visitTime}</div>
    </div>`;
    const urlLine = `<div style='display:flex;justify-content:space-between;align-items:center;margin-top:2px;'>
      <a href='${item.url || ''}' target='_blank' style='color:#1a73e8;font-size:12px;word-break:break-all;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;text-decoration:underline;vertical-align:bottom;'>${item.url || ''}</a>
      <div style='color:#888;font-size:11px;margin-left:8px;flex-shrink:0;'>${durationStr}</div>
    </div>`;
    return `
      <div style='${cardStyle}'>
        <div class='merged-card-header' data-entry-id='${entryId}' style='cursor:pointer;'>
          ${titleLine}
        </div>
        <div id='${entryId}' style='${collapsed ? 'display:none;' : ''}margin-top:6px;'>
          ${urlLine}
          <div style='margin-top:4px;'>${aiContent}</div>
        </div>
      </div>
    `;
  }).join('');

  root.onclick = function(e) {
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

async function clearMergedViewData(root: HTMLElement) {
  try {
    logger.info('清除本地数据（不清除配置）');
    // 只清除 visits_、ai_analysis_ 等业务数据，保留 config
    const allKeys = await storage.keys();
    const keepPrefixes = ['extension_config', 'app_config', 'config', 'settings']; // 可能的配置表前缀
    const keysToRemove = allKeys.filter(k =>
      !keepPrefixes.some(prefix => k.startsWith(prefix)) &&
      (k.startsWith('visits_') || k.startsWith('ai_analysis_') || k.startsWith('highlight_') || k.startsWith('page_') || k.startsWith('record_'))
    );
    await Promise.all(keysToRemove.map(k => storage.remove(k)));
    messenger.send('DATA_CLEARED'); // fire-and-forget，无需等待响应
    root.innerHTML = '<div style="color:#888;padding:16px;">无数据</div>';
  } catch (error) {
    logger.error('清除数据失败', error);
    root.innerHTML = '<div style="color:#e53935;padding:16px;">清除失败</div>';
  }
}

// 清空AI服务配置缓存
function clearAiConfigCache() {
  aiConfigCache = null;
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('sidebar-root');
  if (root) {
    const dayId = new Date().toISOString().slice(0, 10);
    renderMergedView(root, dayId);
    // 只绑定已有按钮事件，不再动态创建按钮
    const clearBtn = document.getElementById('clearDataBtn') as HTMLButtonElement;
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (confirm('确定要清除所有本地数据吗？此操作无法撤销。')) {
          await clearMergedViewData(root);
        }
      };
    }
  }
  // 顶部选项页跳转
  const openOptionsLink = document.getElementById('openOptions') as HTMLAnchorElement;
  if (openOptionsLink) {
    openOptionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
  // 帮助跳转
  const openHelpLink = document.getElementById('openHelp') as HTMLAnchorElement;
  if (openHelpLink) {
    openHelpLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://github.com/yourusername/your-extension/wiki' });
    });
  }
  // 版本号
  const versionInfoEl = document.getElementById('versionInfo') as HTMLElement;
  if (versionInfoEl) {
    const manifest = chrome.runtime.getManifest();
    versionInfoEl.textContent = `版本：${manifest.version}`;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SIDE_PANEL_UPDATE') {
    clearAiConfigCache(); // 配置/数据变更时清空缓存
    const root = document.getElementById('sidebar-root');
    if (root) {
      const dayId = new Date().toISOString().slice(0, 10);
      renderMergedView(root, dayId);
    }
  }
});

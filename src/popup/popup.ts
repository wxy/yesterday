import { messenger } from '../lib/messaging/messenger.js';
import { renderAiCard } from '../lib/ui/ai-card-util.js';
import { config } from '../lib/config/index.js';

function getDayId(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function renderSingleBrief(root: HTMLElement) {
  root.innerHTML = '<div style="color:#888;padding:16px;">加载中...</div>';
  const dayId = getDayId(0);
  // 统一改为 GET_VISITS，兼容新表结构
  const resp = await messenger.send('GET_VISITS', { dayId });
  const visits = Array.isArray(resp?.visits) ? resp.visits : [];
  await messenger.sendWithoutResponse('CLEAR_ICON_STATUS');
  if (!visits.length) {
    root.innerHTML = '<div style="color:#888;padding:16px;">暂无数据</div>';
    return;
  }
  let item = null;
  let header = '最新分析';
  for (let i = visits.length - 1; i >= 0; i--) {
    const a = visits[i];
    const isImportant = a.aiResult && typeof a.aiResult === 'object' && a.aiResult.important === true;
    if (isImportant) {
      item = a;
      header = '最新重要提示';
      break;
    }
    if (!item && a.aiResult) {
      item = a;
    }
  }
  if (!item) {
    root.innerHTML = '<div style="color:#888;padding:16px;">暂无数据</div>';
    return;
  }
  // 直接用 renderAiCard 渲染
  root.innerHTML = renderAiCard(item);
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('mergedDataArea') as HTMLElement;
  if (root) renderSingleBrief(root);
});

// 配置变更自动刷新
config.onConfigChanged(() => {
  const root = document.getElementById('mergedDataArea') as HTMLElement;
  if (root) renderSingleBrief(root);
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
});
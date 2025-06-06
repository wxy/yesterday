import { messenger } from '../lib/messaging/messenger.js';
import { renderAiCard } from '../lib/ui/ai-card-util.js';
import { config } from '../lib/config/index.js';
import { i18n, _ } from '../lib/i18n/i18n.js';

function getDayId(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function renderSingleBrief(root: HTMLElement) {
  // 先渲染静态结构
  root.innerHTML = `<div id="popup-status-text" style="color:#888;padding:16px;"></div>`;
  const statusText = document.getElementById('popup-status-text');
  if (statusText) statusText.textContent = _('popup_loading', '加载中...');
  const dayId = getDayId(0);
  // 统一改为 GET_VISITS，兼容新表结构
  const resp = await messenger.send('GET_VISITS', { dayId });
  const visits = Array.isArray(resp?.visits) ? resp.visits : [];
  await messenger.sendWithoutResponse('CLEAR_ICON_STATUS');
  if (!visits.length) {
    if (statusText) statusText.textContent = _('popup_no_data', '暂无数据');
    return;
  }
  let item = null;
  let header = _('popup_latest_analysis', '最新分析');
  let importantHeader = _('popup_latest_important', '最新重要提示');
  for (let i = visits.length - 1; i >= 0; i--) {
    const a = visits[i];
    const isImportant = a.aiResult && typeof a.aiResult === 'object' && a.aiResult.important === true;
    if (isImportant) {
      item = a;
      header = importantHeader;
      break;
    }
    if (!item && a.aiResult) {
      item = a;
    }
  }
  if (!item) {
    if (statusText) statusText.textContent = _('popup_no_data', '暂无数据');
    return;
  }
  // 用 renderAiCard 渲染主要内容
  root.innerHTML = renderAiCard(item);
}

document.addEventListener('DOMContentLoaded', async () => {
  const allConfig = await config.getAll();
  if (allConfig && allConfig.language && allConfig.language !== 'auto') {
    await i18n.changeLanguage(allConfig.language);
    await i18n.apply();
  }
  const root = document.getElementById('mergedDataArea') as HTMLElement;
  if (root) renderSingleBrief(root);
});

// 配置变更自动刷新
config.onConfigChanged(() => {
  // 语言变更时自动刷新 UI
  window.location.reload();
});

// 监听 AI_SERVICE_UNAVAILABLE 消息
messenger.on('AI_SERVICE_UNAVAILABLE', (msg) => {
  let text = _("ai_service_unavailable_tip", "未检测到可用的本地 AI 服务，AI 分析功能已禁用。");
  const details = msg.payload?.details as Record<string, boolean> | undefined;
  if (details) {
    const availableLabel = _("ai_service_available", "可用");
    const unavailableLabel = _("ai_service_unavailable", "不可用");
    const commaCn = _("comma_cn", "，");
    const detailArr = Object.entries(details).map(([k, v]) => `${k}: ${v ? availableLabel : unavailableLabel}`);
    text += '\n' + detailArr.join(commaCn);
  }
  let aiWarn = document.querySelector('.ai-service-unavailable');
  if (!aiWarn) {
    aiWarn = document.createElement('div');
    aiWarn.className = 'ai-service-unavailable';
    document.body.prepend(aiWarn);
  }
  aiWarn.textContent = text;
});
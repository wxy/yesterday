// 跨日检测与任务调度逻辑
import { handleCrossDayCleanup } from './visit-ai.js';
import { Logger } from '../lib/logger/logger.js';
import { config } from '../lib/config/index.js';

const logger = new Logger('cross-day');
let lastKnownDayId = new Date().toISOString().slice(0, 10);

async function getCrossDayIdleThresholdMs() {
  const allConfig = await config.getAll();
  if (allConfig && typeof allConfig['crossDayIdleThreshold'] === 'number') {
    return allConfig['crossDayIdleThreshold'] * 60 * 60 * 1000;
  }
  return 6 * 60 * 60 * 1000; // 默认 6 小时
}

function getCurrentDayId() {
  const now = Date.now();
  return new Date(now).toISOString().slice(0, 10);
}

export async function shouldTriggerCrossDayTask() {
  const currentDayId = getCurrentDayId();
  return currentDayId !== lastKnownDayId;
}

export async function tryHandleCrossDayTask() {
  if (await shouldTriggerCrossDayTask()) {
    await handleCrossDayCleanup();
    lastKnownDayId = getCurrentDayId();
    logger.info('[跨日任务] 已执行跨日清理与日报生成，当前日期已更新为 {0}', lastKnownDayId);
  }
}

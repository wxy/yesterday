// 访问记录与 AI 分析模块
// src/background/visit-ai.ts
import { storage } from '../lib/storage/index.js';
import { Logger } from '../lib/logger/logger.js';
import { isSystemUrl } from '../lib/browser-events/system-url.js';

const logger = new Logger('visit-ai');

export const VISIT_KEEP_DAYS = 7;

export async function handlePageVisitRecord(data: any) {
  try {
    // 兼容 content-script 可能传递 { payload: {...} } 的情况
    const record = data && data.payload && typeof data.payload === 'object' ? data.payload : data;
    // 字段完整性校验：url、title、id 必须存在且为非空字符串
    if (!record || typeof record.url !== 'string' || !record.url.trim() || typeof record.title !== 'string' || !record.title.trim() || typeof record.id !== 'string' || !record.id.trim()) {
      logger.warn('[内容捕获] 拒绝插入无效访问记录，字段不全', { data });
      return { status: 'invalid' };
    }
    // 兜底：系统页面不记录
    if (isSystemUrl(record.url)) {
      logger.info('[内容捕获] 跳过系统页面', { url: record.url });
      return { status: 'system' };
    }
    if (!('aiResult' in record)) {
      record.aiResult = '正在进行 AI 分析';
    }
    if (!record.visitStartTime || isNaN(new Date(record.visitStartTime).getTime())) {
      // 自动补当前时间
      const now = Date.now();
      record.visitStartTime = now;
      logger.warn('visitStartTime 缺失或非法，已自动补当前时间', { id: record.id, url: record.url, visitStartTime: now });
    }
    const isRefresh = !!record.isRefresh;
    const date = new Date(record.visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let existed = false;
    let updated = false;
    for (const v of visits) {
      if (v.url === record.url) {
        existed = true;
        if (isRefresh) {
          // 刷新：更新内容、时间戳、id、visitCount+1
          v.title = record.title;
          v.mainContent = record.mainContent;
          v.visitStartTime = record.visitStartTime;
          v.id = record.id;
          v.aiResult = record.aiResult;
          v.visitCount = (v.visitCount || 1) + 1;
          updated = true;
        } else {
          // 非刷新：只递增visitCount
          v.visitCount = (v.visitCount || 1) + 1;
          updated = true;
        }
        break;
      }
    }
    if (!existed) {
      record.visitCount = 1;
      visits.push(record);
      updated = true;
      logger.info(`[内容捕获] 已存储访问记录`, { url: record.url, dayId, id: record.id });
    } else if (isRefresh) {
      logger.info(`[内容捕获] 刷新并更新访问记录`, { url: record.url, dayId, id: record.id });
    } else {
      logger.info(`[内容捕获] 跳过重复访问记录，仅递增visitCount`, { url: record.url, dayId, id: record.id });
    }
    if (updated) {
      await storage.set(key, visits);
    }
    await cleanupOldVisits();
    return { status: existed ? (isRefresh ? 'refresh' : 'repeat') : 'new' };
  } catch (err) {
    logger.error('存储页面访问记录失败', err);
    return { status: 'error' };
  }
}

// 移除 ai_analysis 相关逻辑，所有分析结果直接写入 visits_ 表

export async function updateVisitAiResult(
  url: string,
  visitStartTime: number,
  aiResult: any, // 由 string 改为 any，支持对象
  analyzeDuration: number,
  id?: string
) {
  try {
    logger.debug('[AI调试] updateVisitAiResult called', { url, visitStartTime, id, aiResultType: typeof aiResult, aiResult });
    if (!id) {
      logger.error('updateVisitAiResult 缺少 id，无法唯一定位访问记录', { url, visitStartTime, aiResult });
      return;
    }
    const date = new Date(visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let updated = false;
    for (const v of visits) {
      if (v.id === id) {
        logger.debug('[AI调试] 命中访问记录，准备写入 aiResult', { v });
        v.aiResult = aiResult;
        v.analyzeDuration = analyzeDuration;
        updated = true;
        break;
      }
    }
    if (updated) {
      logger.debug('[AI调试] 已更新 visits，准备写入 storage', { visits });
      await storage.set(key, visits);
      logger.info(`[AI] 已更新访问记录的 aiResult`, { url, dayId, id });
      logger.info(`[AI] 分析结果内容`, { id, aiResult });
    } else {
      logger.warn('[AI调试] 未找到匹配的访问记录（仅按 id 匹配），aiResult 未写入', { url, visitStartTime, id });
    }
  } catch (err) {
    logger.error('更新访问记录 aiResult 失败', err);
  }
}

export async function getVisitsByDay(dayId: string) {
  const key = `visits_${dayId}`;
  return (await storage.get<any[]>(key)) || [];
}

export async function cleanupOldVisits() {
  try {
    const allKeys: string[] = await storage.keys();
    const visitKeys = allKeys.filter(k => k.startsWith('visits_'));
    const days = visitKeys.map(k => k.replace('visits_', ''));
    const sortedDays = days.sort().reverse();
    const keepDays = sortedDays.slice(0, VISIT_KEEP_DAYS);
    const removeDays = sortedDays.slice(VISIT_KEEP_DAYS);
    for (const day of removeDays) {
      await storage.remove(`visits_${day}`);
      logger.info(`[内容捕获] 已清理过期访问数据`, { day });
    }
  } catch (err) {
    logger.error('清理过期访问数据失败', err);
  }
}

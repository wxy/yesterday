// 访问记录与 AI 分析模块
// src/background/visit-ai.ts
import { storage } from '../lib/storage/index.js';
import { Logger } from '../lib/logger/logger.js';

const logger = new Logger('visit-ai');

export const VISIT_KEEP_DAYS = 7;

export async function handlePageVisitRecord(data: any) {
  try {
    if (!data.visitStartTime || isNaN(new Date(data.visitStartTime).getTime())) {
      logger.error('无效的 visitStartTime，无法存储访问记录', JSON.stringify(data));
      return;
    }
    const date = new Date(data.visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    if (!visits.some(v => v.url === data.url && v.visitStartTime === data.visitStartTime)) {
      visits.push(data);
      await storage.set(key, visits);
      logger.info(`[内容捕获] 已存储访问记录`, { url: data.url, dayId });
    } else {
      logger.info(`[内容捕获] 跳过重复访问记录`, { url: data.url, dayId });
    }
    await cleanupOldVisits();
  } catch (err) {
    logger.error('存储页面访问记录失败', err);
  }
}

export async function updateVisitAiResult(url: string, visitStartTime: number, aiResult: string, analyzeDuration: number, id?: string) {
  try {
    if (!visitStartTime || isNaN(new Date(visitStartTime).getTime())) {
      logger.error('无效的 visitStartTime，无法更新 aiResult', { url, visitStartTime });
      return;
    }
    const date = new Date(visitStartTime);
    const dayId = date.toISOString().slice(0, 10);
    const key = `visits_${dayId}`;
    const visits: any[] = (await storage.get<any[]>(key)) || [];
    let updated = false;
    for (const v of visits) {
      if ((id && v.id === id) || (!id && v.url === url && v.visitStartTime === visitStartTime)) {
        v.aiResult = aiResult;
        v.analyzeDuration = analyzeDuration;
        updated = true;
        break;
      }
    }
    if (updated) {
      await storage.set(key, visits);
      logger.info(`[AI] 已更新访问记录的 aiResult`, { url, dayId, id });
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

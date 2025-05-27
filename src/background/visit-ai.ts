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

export async function updateAiAnalysis(id: string, aiResult: string, dayId: string) {
  try {
    const key = `ai_analysis_${dayId}`;
    const analysisList: any[] = (await storage.get<any[]>(key)) || [];
    let found = false;
    for (const item of analysisList) {
      if (item.id === id) {
        item.aiResult = aiResult;
        found = true;
        break;
      }
    }
    if (!found) {
      analysisList.push({ id, aiResult });
    }
    await storage.set(key, analysisList);
    logger.info(`[AI] 已更新 ai_analysis`, { dayId, id });
  } catch (err) {
    logger.error('更新 ai_analysis 失败', err);
  }
}

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
      // 新增：同步写入/更新 ai_analysis_${dayId}
      try {
        const aiAnalysisKey = `ai_analysis_${dayId}`;
        let aiAnalysis: any[] = (await storage.get<any[]>(aiAnalysisKey)) || [];
        let found = false;
        for (const a of aiAnalysis) {
          if (a.id === id) {
            a.aiResult = aiResult;
            a.analyzeDuration = analyzeDuration;
            found = true;
            break;
          }
        }
        if (!found) {
          // 若不存在则新增，补全所有元信息
          const v = visits.find((vv: any) => vv.id === id);
          aiAnalysis.push({ id, url, visitStartTime, aiResult, analyzeDuration, title: v?.title, pageTitle: v?.pageTitle });
        }
        await storage.set(aiAnalysisKey, aiAnalysis);
        logger.info(`[AI] 已同步写入/更新 ai_analysis`, { aiAnalysisKey, id });
      } catch (err) {
        logger.error('同步写入 ai_analysis 失败', { id, err });
      }
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

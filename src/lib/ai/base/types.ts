// AI 能力类型定义
export interface PageAISummary {
  summary: string;
  highlights: string[];
  specialConcerns?: string[];
  important: boolean;
}

export interface DailyAIReport {
  date: string;
  summaries: PageAISummary[];
  suggestions: string[];
}

export interface AISummaryCapability {
  summarizePage(url: string, content: string): Promise<PageAISummary>;
}

export interface AIReportCapability {
  generateDailyReport(date: string, pageSummaries: PageAISummary[]): Promise<DailyAIReport>;
}

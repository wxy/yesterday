import { AIBaseService } from '../base/ai-base.js';
import type { PageAISummary, DailyAIReport } from '../base/types.js';
import { _ , _Error } from '../../i18n/i18n.js';

// 迁移自 ollama-client
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
interface OllamaChatRequest {
  model?: string;
  messages: OllamaMessage[];
  url?: string;
  signal?: AbortSignal;
  meta?: Record<string, any>;
}
interface OllamaChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OllamaMessage;
    finish_reason: string;
  }>;
}
const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1/chat/completions';
const DEFAULT_MODEL = 'llama3.1';
async function chatWithOllama({ messages, model = DEFAULT_MODEL, url = DEFAULT_OLLAMA_URL, signal, meta }: OllamaChatRequest): Promise<OllamaChatResponse> {
  const body = JSON.stringify({ model, messages, ...meta });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal
  });
  if (!resp.ok) throw new Error('Ollama API 请求失败: ' + resp.status);
  return await resp.json();
}

export class OllamaService extends AIBaseService {
  readonly id = 'ollama';
  readonly name = 'Ollama AI';

  constructor() {
    super('OllamaService');
  }

  async isAvailable(): Promise<boolean> {
    try {
      await chatWithOllama({ messages: [{ role: 'user', content: 'ping' }] });
      return true;
    } catch (e: any) {
      this.logger.warn(_('ai_ollama_unavailable', 'Ollama 服务不可用: {0}', e && (e.message || String(e))));
      return false;
    }
  }

  async summarizePage(url: string, content: string): Promise<PageAISummary> {
    this.logger.info(_('ai_ollama_summarize', 'Ollama 正在总结页面: {0}', url));
    try {
      // 新增：严格结构化 JSON 输出要求
      const metaPrompt =
        `你是一位专业的网页内容分析助手。请你认真分析下方网页内容，并以 JSON 格式返回结构化结果。务必严格遵循如下格式和要求：\n\n` +
        `{"summary": "简明摘要，1-3句话，内容为纯文本",\n` +
        ` "highlights": ["重点1", "重点2"], // 重点条目，数组，每项为完整的、通顺的中文句子，内容为纯文本\n` +
        ` "important": ["高亮内容"], // 如有高亮，数组，每项为完整的、通顺的中文句子，内容为纯文本，无则为空数组\n` +
        ` "specialConcerns": ["特殊关注点"] // 如有特殊关注点，数组，每项为完整的、通顺的中文句子，内容为纯文本，无则为空数组\n}` +
        `\n\n要求：\n` +
        `- summary 只做摘要，不要混入重点或高亮。\n` +
        `- highlights 只做重点条目，且每项必须是完整的、通顺的中文句子，不要只给短语或词组。\n` +
        `- important 只做高亮内容，且每项必须是完整的、通顺的中文句子，无则返回空数组。\n` +
        `- specialConcerns 只做特殊关注点，且每项必须是完整的、通顺的中文句子，无则返回空数组。\n` +
        `- 所有内容均为纯文本，不要 markdown。\n` +
        `- 只返回上述 JSON，不要输出其它内容。\n` +
        `- 如果理解无误，请直接返回符合上述格式的 JSON。\n` +
        `- 注意要严格符合 JSON 语法，所有 key 必须加双引号，数组/对象结尾不能有逗号，正确使用 {} 包围，不要输出多余内容。`;
      const prompt = `${metaPrompt}\n\n网页内容：\n${content}`;
      const resp = await chatWithOllama({
        messages: [
          { role: 'system', content: '你是一个网页内容分析助手。' },
          { role: 'user', content: prompt }
        ]
      });
      const text = resp.choices?.[0]?.message?.content || '';
        this.logger.debug( text);
      // 优先尝试解析为 JSON，增强兼容性
      let parsed: any = null;
      try {
        let jsonText = text.trim()
          .replace(/^[^\{]*\{/, '{') // 去除前面多余内容
          .replace(/,\s*([}\]])/g, '$1') // 去除数组/对象结尾多余逗号
          .replace(/'/g, '"') // 单引号转双引号
          .replace(/([,{]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // 未加引号的 key
          .replace(/\n/g, ' ') // 换行转空格
          .replace(/[\u200B-\u200D\uFEFF]/g, ''); // 去除不可见字符
        if (jsonText.startsWith('{')) {
          parsed = JSON.parse(jsonText);
        }
      } catch (e) {
        this.logger.warn('[Ollama JSON 解析失败]', e);
      }
      if (parsed && typeof parsed === 'object') {
        return {
          summary: parsed.summary || '',
          highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
          specialConcerns: Array.isArray(parsed.specialConcerns) ? parsed.specialConcerns : [],
          important: Array.isArray(parsed.important) ? parsed.important.length > 0 : false
        };
      }
      // fallback 兼容老逻辑
      const [summary, ...rest] = text.split(/\n+/);
      return {
        summary: summary || text,
        highlights: rest.filter(Boolean).slice(0, 5),
        specialConcerns: [],
        important: /重要|必须|必看|highly recommended|critical/i.test(text)
      };
    } catch (e: any) {
      throw new _Error('ai_ollama_summarize_error', 'Ollama 总结失败: {0}', e?.message || String(e));
    }
  }

  async generateDailyReport(date: string, pageSummaries: PageAISummary[]): Promise<DailyAIReport> {
    this.logger.info(_('ai_ollama_report', 'Ollama 正在生成日报: {0}', date));
    try {
      const summaryText = pageSummaries.map((s, i) => `页面${i + 1}: ${s.summary}`).join('\n');
      const prompt = `请根据以下昨日网页摘要，生成一份简明的用户浏览日报，并给出3条有益建议：\n${summaryText}`;
      const resp = await chatWithOllama({
        messages: [
          { role: 'system', content: '你是一个用户行为分析助手。' },
          { role: 'user', content: prompt }
        ]
      });
      const text = resp.choices?.[0]?.message?.content || '';
      const suggestions = text.split(/\n+/).filter(Boolean).slice(-3);
      return {
        date,
        summaries: pageSummaries,
        suggestions
      };
    } catch (e: any) {
      throw new _Error('ai_ollama_report_error', 'Ollama 日报生成失败: {0}', e?.message || String(e));
    }
  }
}

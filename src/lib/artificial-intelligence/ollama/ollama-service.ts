import { AIBaseService } from '../base/ai-base.js';
import type { PageAISummary, DailyAIReport } from '../base/types.js';
import { _ , _Error } from '../../i18n/i18n.js';
import JSON5 from 'json5';

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

// 工具函数：本地预处理并尝试解析 JSON
function parseJsonWithPreprocess(text: string, logger: any): any {
  let jsonText = text.trim()
    .replace(/^[^\{]*\{/, '{')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([,{]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
    .replace(/\n/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (jsonText.startsWith('{') && !jsonText.endsWith('}')) {
    jsonText = jsonText + '}';
  }
  try {
    if (jsonText.startsWith('{')) {
      return JSON5.parse(jsonText);
    }
  } catch (e) {
    logger?.warn('[Ollama JSON5 本地预处理解析失败]', e);
  }
  return null;
}

// 工具函数：AI 修复 JSON，返回修复后的字符串
async function repairJsonWithAI(text: string, logger: any): Promise<string | null> {
  // 本地解析失败，请求 AI 修复
  try {
    const fixPrompt =
      `你刚才输出的 JSON 解析失败，请严格修复为合法 JSON 格式，只返回 JSON，不要输出其它内容。原始内容如下：\n${text}`;
    const fixResp = await chatWithOllama({
      messages: [
        { role: 'system', content: '你是一个 JSON 修复助手。' },
        { role: 'user', content: fixPrompt }
      ]
    });
    let fixedJsonText = (fixResp.choices?.[0]?.message?.content || '').trim();
    if (fixedJsonText) {
      logger?.info('[Ollama JSON5 AI 修复成功]');
      return fixedJsonText;
    }
  } catch (fixErr) {
    logger?.warn('[Ollama JSON5 AI 修复失败]', fixErr);
  }
  return null;
}

export class OllamaService extends AIBaseService {
  readonly id = 'ollama';
  readonly name = 'Ollama AI';

  constructor() {
    super('OllamaService');
  }

  async isAvailable(): Promise<boolean> {
    const maxRetry = 3;
    const showUrl = 'http://localhost:11434/api/show';
    for (let i = 0; i < maxRetry; i++) {
      try {
        // 正确用 POST 检查模型可用性
        const resp = await fetch(showUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DEFAULT_MODEL })
        });
        if (resp.ok) {
          this.logger.debug('Ollama 可用（/api/show POST 检查）');
          return true;
        } else {
          this.logger.warn(`Ollama 检查失败（/api/show POST 检查）状态码: ${resp.status}`);
        }
      } catch (e: any) {
        this.logger.warn(`Ollama 检查异常（/api/show POST 检查）`, e);
      }
      // 降级用 chatWithOllama
      try {
        await chatWithOllama({ messages: [{ role: 'user', content: 'ping' }] });
        this.logger.debug('Ollama 可用（chatWithOllama ping 检查）');
        return true;
      } catch (e: any) {
        this.logger.warn(_('ai_ollama_unavailable', `Ollama 服务可用性检测失败(第${i+1}次): {0}`, e && (e.message || String(e))));
      }
      if (i < maxRetry - 1) await new Promise(res => setTimeout(res, 200));
    }
    this.logger.warn(_('ai_ollama_unavailable', 'Ollama 服务不可用: {0}', '连续多次检测失败'));
    return false;
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
      // 先本地预处理解析
      let parsed: any = parseJsonWithPreprocess(text, this.logger);
      if (!parsed) {
        // 本地失败，AI 修复
        const aiFixed = await repairJsonWithAI(text, this.logger);
        if (aiFixed) {
          parsed = parseJsonWithPreprocess(aiFixed, this.logger);
        }
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

  /**
   * 生成每日洞察/日报（结构化）
   * @param date 日期字符串（如 2024-05-29）
   * @param pageSummaries 页面摘要数组（PageAISummary[]）
   * @param options 可选：{ timeout: number } 超时时间（毫秒）
   */
  async generateDailyReport(date: string, pageSummaries: PageAISummary[], options?: { timeout?: number }): Promise<DailyAIReport> {
    this.logger.info(_('ai_ollama_report', 'Ollama 正在生成日报: {0}', date));
    const timeout = options?.timeout ?? 30000;
    try {
      // 拼接结构化 prompt
      const metaPrompt =
        `你是一位专业的数字生活洞察分析师。请你根据下方所有网页的结构化摘要，输出如下结构化 JSON：\n` +
        `{"summary": "整体趋势与建议（不少于80字）",\n"highlights": ["昨日亮点1", "昨日亮点2"],\n"specialConcerns": ["需特别关注的问题1"]}\n` +
        `要求：\n- summary 字段为纯文本，内容不少于80字，包含整体趋势、建议、风险或提升空间。\n- highlights 为昨日最值得关注的3条亮点，数组，每项为完整中文句子。\n- specialConcerns 为需特别关注的问题，数组，每项为完整中文句子，无则返回空数组。\n- 所有内容均为纯文本，不要 markdown。\n- 只返回上述 JSON，不要输出其它内容。\n- 注意严格 JSON 语法，所有 key 必须加双引号。`;
      const summaryText = pageSummaries.map((s, i) => `页面${i + 1}: ${s.summary}`).join('\n');
      const prompt = `${metaPrompt}\n\n网页摘要：\n${summaryText}`;
      // 超时控制
      const resp = await Promise.race([
        chatWithOllama({
          messages: [
            { role: 'system', content: '你是一个数字生活洞察分析师。' },
            { role: 'user', content: prompt }
          ]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Ollama 洞察生成超时')), timeout))
      ]);
      const text = (resp as OllamaChatResponse).choices?.[0]?.message?.content || '';
      // 尝试结构化解析
      let parsed: any = parseJsonWithPreprocess(text, this.logger);
      if (!parsed) {
        const aiFixed = await repairJsonWithAI(text, this.logger);
        if (aiFixed) {
          parsed = parseJsonWithPreprocess(aiFixed, this.logger);
        }
      }
      if (parsed && typeof parsed === 'object') {
        // suggestions 字段为 highlights + specialConcerns 合并
        const suggestions: string[] = [];
        if (Array.isArray(parsed.highlights)) suggestions.push(...parsed.highlights);
        if (Array.isArray(parsed.specialConcerns)) suggestions.push(...parsed.specialConcerns);
        return {
          date,
          summaries: pageSummaries,
          suggestions
        };
      }
      // fallback 兼容老逻辑
      return {
        date,
        summaries: pageSummaries,
        suggestions: [text]
      };
    } catch (e: any) {
      throw new _Error('ai_ollama_report_error', 'Ollama 日报/洞察生成失败: {0}', e?.message || String(e));
    }
  }
}

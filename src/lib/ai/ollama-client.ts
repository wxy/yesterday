// filepath: src/lib/ai/ollama-client.ts
/**
 * Ollama 本地 AI 客户端，兼容 OpenAI Chat API
 * 支持简单的对话分析调用
 */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string; // 如 "llama3"、"qwen:14b" 等
  messages: OllamaMessage[];
  stream?: boolean;
}

export interface OllamaChatResponse {
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

export async function chatWithOllama({
  messages,
  model = DEFAULT_MODEL,
  url = DEFAULT_OLLAMA_URL,
  signal,
  meta // 新增参数：可选的元信息
}: {
  messages: OllamaMessage[];
  model?: string;
  url?: string;
  signal?: AbortSignal;
  meta?: {
    url?: string;
    title?: string;
    fetchTime?: string;
    [key: string]: any;
  };
}): Promise<OllamaChatResponse> {
  // 如果有 meta 信息，自动拼接到 system prompt
  let patchedMessages = messages;
  if (meta && (meta.url || meta.title || meta.fetchTime)) {
    const metaPrompt =
      `【网页元信息】\n` +
      (meta.title ? `标题: ${meta.title}\n` : '') +
      (meta.url ? `URL: ${meta.url}\n` : '') +
      (meta.fetchTime ? `抓取时间: ${meta.fetchTime}\n` : '') +
      `请结合这些信息分析下方网页内容。`;
    // 如果第一个是 system prompt，则合并，否则插入
    if (messages.length > 0 && messages[0].role === 'system') {
      patchedMessages = [
        { role: 'system', content: metaPrompt + '\n' + messages[0].content },
        ...messages.slice(1)
      ];
    } else {
      patchedMessages = [
        { role: 'system', content: metaPrompt },
        ...messages
      ];
    }
  }
  console.log('[ollama-client] chatWithOllama called', { patchedMessages, model, url });
  const body: OllamaChatRequest = {
    model,
    messages: patchedMessages
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  console.log('[ollama-client] fetch 返回', resp);
  if (!resp.ok) {
    // 捕获 HTML 错误页内容，便于前端显示
    const text = await resp.text();
    let err = new Error(`Ollama API 请求失败: ${resp.status} ${resp.statusText}`);
    (err as any).responseText = text;
    // 用 window 对象输出，确保在 content-script/background/page/popup 都能看到
    if (typeof window !== 'undefined' && window.console) {
      window.console.error('Ollama API 响应内容:', text);
    }
    // 也挂到 error 对象上，前端可完整显示
    (err as any).fullResponse = text;
    throw err;
  }
  const json = await resp.json();
  console.log('[ollama-client] fetch json', json);
  return json;
}

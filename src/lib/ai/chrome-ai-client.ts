// filepath: src/lib/ai/chrome-ai-client.ts
// Chrome AI Summarizer API 客户端封装，专注于与 Chrome API 通信

export interface ChromeAiSummarizeOptions {
  url?: string;
  text?: string;
  title?: string;
}

export interface ChromeAiSummarizeResult {
  summary: string;
  highlights?: string[];
  points?: string[];
  suggestion?: string;
  [key: string]: any;
}

export async function chromeAiSummarize(options: ChromeAiSummarizeOptions & { signal?: AbortSignal }): Promise<ChromeAiSummarizeResult> {
  const summarizerGlobal = (typeof window !== 'undefined' ? (window as any).Summarizer : undefined) || (typeof globalThis !== 'undefined' ? (globalThis as any).Summarizer : undefined);
  if (!summarizerGlobal || typeof summarizerGlobal.availability !== 'function' || typeof summarizerGlobal.create !== 'function') {
    throw new Error('全局 Summarizer API 不存在');
  }
  // 检查可用性
  const availability = await summarizerGlobal.availability();
  if (availability !== 'available') {
    throw new Error('Summarizer API 不可用');
  }
  // 每次都 create 新实例，避免 session 被销毁
  const createOptions: any = {
    sharedContext: options.title || options.url || '',
    type: 'key-points',
    format: 'markdown',
    length: 'medium',
  };
  const summarizer = await summarizerGlobal.create(createOptions);
  // 支持 signal 软中断，abort 时主动销毁 session
  if (options.signal) {
    let aborted = false;
    return Promise.race([
      summarizer.summarize(options.text, { context: options.title || options.url || '' }),
      new Promise((_, reject) => {
        options.signal!.addEventListener('abort', () => {
          aborted = true;
          if (typeof summarizer.destroy === 'function') {
            try { summarizer.destroy(); } catch (e) { /* ignore */ }
          }
          reject(new Error('AI 分析超时'));
        });
      })
    ]).then((result: any) => {
      if (aborted) throw new Error('AI 分析超时');
      // 兼容 Chrome AI 返回的“类数组对象”结构，自动拼接纯文本
      let summary = result.summary || '';
      if (!summary) {
        // 提取所有数字 key 的字符并拼接
        const textArr: string[] = [];
        Object.keys(result).forEach(k => {
          if (/^\d+$/.test(k)) textArr[Number(k)] = result[k];
        });
        summary = textArr.join('').trim();
      }
      return {
        summary,
        highlights: result.highlights || [],
        points: result.points || [],
        suggestion: result.suggestion || '',
        ...result
      };
    }).finally(() => {
      if (typeof summarizer.destroy === 'function') {
        try { summarizer.destroy(); } catch (e) { /* ignore */ }
      }
    });
  } else {
    try {
      const result = await summarizer.summarize(options.text, { context: options.title || options.url || '' });
      // 兼容 Chrome AI 返回的“类数组对象”结构，自动拼接纯文本
      let summary = result.summary || '';
      if (!summary) {
        const textArr: string[] = [];
        Object.keys(result).forEach(k => {
          if (/^\d+$/.test(k)) textArr[Number(k)] = result[k];
        });
        summary = textArr.join('').trim();
      }
      return {
        summary,
        highlights: result.highlights || [],
        points: result.points || [],
        suggestion: result.suggestion || '',
        ...result
      };
    } finally {
      if (typeof summarizer.destroy === 'function') {
        try { summarizer.destroy(); } catch (e) { /* ignore */ }
      }
    }
  }
}

export async function checkChromeAiAvailability(): Promise<{ available: boolean; reason?: string }> {
  try {
    const summarizerGlobal = (typeof window !== 'undefined' ? (window as any).Summarizer : undefined) || (typeof globalThis !== 'undefined' ? (globalThis as any).Summarizer : undefined);
    if (!summarizerGlobal || typeof summarizerGlobal.availability !== 'function') {
      console.warn('[chrome-ai-client] 全局 Summarizer API 不存在');
      return { available: false, reason: '全局 Summarizer API 不存在' };
    }
    const availability = await summarizerGlobal.availability();
    if (availability === 'unavailable') {
      return { available: false, reason: 'Summarizer API 不可用' };
    }
    // 尝试 create 实例
    try {
      const summarizer = await summarizerGlobal.create({ type: 'key-points', format: 'markdown', length: 'short' });
      if (availability !== 'available' && typeof summarizer.ready === 'object' && typeof summarizer.ready.then === 'function') {
        await summarizer.ready;
      }
      return { available: true };
    } catch (e: any) {
      return { available: false, reason: e?.message || String(e) };
    }
  } catch (e: any) {
    return { available: false, reason: e?.message || String(e) };
  }
}


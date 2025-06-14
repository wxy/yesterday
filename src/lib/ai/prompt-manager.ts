import { Logger } from '../logger/logger.js';
import { ChromeStorageAdapter } from '../storage/adapters/chrome-storage.js';
import { i18n } from '../i18n/i18n.js';

export interface PromptEntry {
  id: string;
  type: 'system' | 'user';
  content: {
    en: string;
    [lang: string]: string;
  };
  defaultLang: string;
  meta: {
    tags?: string[];
    source?: 'builtin' | 'user';
    createdAt: number;
    updatedAt: number;
    [key: string]: any;
  };
}

const logger = new Logger('PromptManager');
const PROMPT_DB_KEY = 'yesterday_prompts';
const SYSTEM_PROMPTS_PATH = 'assets/prompts/system-prompts.json';
const USER_PROMPTS_PATH = 'assets/prompts/user-prompts.json';

export class PromptManager {
  private static storage = new ChromeStorageAdapter({ type: 'local' });

  // 加载并合并 system/user prompts，存入数据库
  static async loadAllPrompts() {
    try {
      const [sysResp, userResp] = await Promise.all([
        fetch(chrome.runtime.getURL(SYSTEM_PROMPTS_PATH)),
        fetch(chrome.runtime.getURL(USER_PROMPTS_PATH))
      ]);
      if (!sysResp.ok) {
        logger.error('Failed to fetch system prompts', { url: SYSTEM_PROMPTS_PATH, status: sysResp.status });
        return;
      }
      if (!userResp.ok) {
        logger.error('Failed to fetch user prompts', { url: USER_PROMPTS_PATH, status: userResp.status });
        return;
      }
      let systemPrompts, userPrompts;
      try {
        systemPrompts = await sysResp.json();
      } catch (e) {
        logger.error('System prompts JSON parse error', e);
        return;
      }
      try {
        userPrompts = await userResp.json();
      } catch (e) {
        logger.error('User prompts JSON parse error', e);
        return;
      }
      const allPrompts = [...systemPrompts, ...userPrompts];
      await PromptManager.storage.set(PROMPT_DB_KEY, allPrompts);
      logger.info('All prompts loaded and merged.', { count: allPrompts.length });
    } catch (e) {
      logger.error('Failed to load prompts', e);
    }
  }

  // 获取当前语言，确保 i18n 已初始化，保证全局一致
  static async getCurrentLang(): Promise<string> {
    //await i18n.init(); // 保证 messages.json 已加载
    //return i18n.getCurrentLanguage();
    return 'en';
  }

  // 获取指定类型和语言的提示词，lang 可选
  static async getPrompts(type: 'system' | 'user', lang?: string): Promise<PromptEntry[]> {
    if (!lang) lang = await PromptManager.getCurrentLang();
    let all = (await PromptManager.storage.get(PROMPT_DB_KEY)) as PromptEntry[] || [];
    if (!all.length) {
      await PromptManager.loadAllPrompts();
      all = (await PromptManager.storage.get(PROMPT_DB_KEY)) as PromptEntry[] || [];
      if (!all.length) {
        logger.error('FATAL: Prompt DB is still empty after loadAllPrompts!');
      }
    }
    return all.filter(e => e.type === type).map(e => {
      const content = e.content[lang!] || e.content['en'];
      if (!content) {
        logger.warn('Prompt missing content for lang', { id: e.id, lang });
      }
      return { ...e, content: { ...e.content, [lang!]: content } };
    });
  }

  // 获取单条提示词，lang 可选
  static async getPromptById(id: string, lang?: string): Promise<PromptEntry | null> {
    if (!lang) lang = await PromptManager.getCurrentLang();
    let all = (await PromptManager.storage.get(PROMPT_DB_KEY)) as PromptEntry[] || [];
    if (!all.length) {
      await PromptManager.loadAllPrompts();
      all = (await PromptManager.storage.get(PROMPT_DB_KEY)) as PromptEntry[] || [];
      if (!all.length) {
        logger.error('FATAL: Prompt DB is still empty after loadAllPrompts!');
      }
    }
    const entry = all.find(e => e.id === id);
    if (!entry) return null;
    const content = entry.content[lang!] || entry.content['en'];
    if (!content) {
      logger.warn('Prompt missing content for lang', { id, lang });
    }
    return { ...entry, content: { ...entry.content, [lang!]: content } };
  }

  // 后续可扩展：添加/编辑/删除用户自定义提示词
}

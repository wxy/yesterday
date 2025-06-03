// 综合系统页面、排除/包含规则的URL过滤工具
import { config } from '../config/index.js';

// 系统页面（如 chrome://、edge://、about:、file:// 等）识别
export function isSystemUrl(url: string): boolean {
  return /^(chrome|edge|about|file):\/\//i.test(url);
}

// 内置排除类型对应的通配符/正则规则
const EXCLUDE_TYPE_PATTERNS: Record<string, (string|RegExp)[]> = {
  intranet: [
    /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.|localhost)/i
  ],
  ip: [
    /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(?::\d+)?/i
  ],
  port: [
    /^https?:\/\/[^\/]+:(?!80$|443$)\d+/i
  ],
  auth: [
    /^https?:\/\/[^\/]+:[^@]+@/i
  ]
};

// 通配符转正则
function wildcardToRegExp(pattern: string): RegExp {
  // 支持 * 通配符，简单转义
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$', 'i');
}

// 通用 URL 归一化方法
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url.split('#')[0];
  }
}

// 判断url是否命中包含/排除规则
export async function shouldAnalyzeUrl(url: string): Promise<boolean> {
  if (!url || typeof url !== 'string') return false;
  if (isSystemUrl(url)) return false;

  // 1. includeUrls 优先，命中则强制分析
  const urlFilterGroup: any = await config.get('urlFilterGroup') || {};
  const includeList: string[] = Array.isArray(urlFilterGroup.includeUrls) ? urlFilterGroup.includeUrls : [];
  for (const pattern of includeList) {
    if (!pattern.trim()) continue;
    let reg: RegExp;
    try {
      reg = wildcardToRegExp(pattern.trim());
    } catch { continue; }
    if (reg.test(url)) return true;
  }

  // 2. excludeTypes 规则
  const excludeTypes: string[] = Array.isArray(urlFilterGroup.excludeTypes) ? urlFilterGroup.excludeTypes : [];
  for (const type of excludeTypes) {
    const patterns = EXCLUDE_TYPE_PATTERNS[type] || [];
    for (const pat of patterns) {
      if (typeof pat === 'string') {
        if (url.includes(pat)) return false;
      } else if (pat instanceof RegExp) {
        if (pat.test(url)) return false;
      }
    }
  }

  // 3. excludeUrls 规则
  const excludeList: string[] = Array.isArray(urlFilterGroup.excludeUrls) ? urlFilterGroup.excludeUrls : [];
  for (const pattern of excludeList) {
    if (!pattern.trim()) continue;
    let reg: RegExp;
    try {
      reg = wildcardToRegExp(pattern.trim());
    } catch { continue; }
    if (reg.test(url)) return false;
  }

  // 默认分析
  return true;
}

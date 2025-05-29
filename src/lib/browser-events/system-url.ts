// 系统页面（如 chrome://、edge://、about:、file:// 等）识别工具
export function isSystemUrl(url: string): boolean {
  return /^(chrome|edge|about|file):\/\//i.test(url);
}

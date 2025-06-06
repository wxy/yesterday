/**
 * 本地化工具类
 * 支持强制指定本地化，和两种使用方式：
 * 1. 静态 HTML 本地化 (data-i18n 属性)
 * 2. 动态获取本地化字符串 (i18n 函数)
 */

// 为避免与 logger 循环依赖，直接使用 console 打印

// 本地化消息类型
interface LocaleMessages {
  [key: string]: { message: string; description?: string };
}

export class I18n {
  private static instance: I18n;
  private loadedMessages: LocaleMessages = {};
  private fallbackMessages: LocaleMessages = {};
  private forcedLocale: string | null = null;
  private initPromise: Promise<void> | null = null;
  private defaultLocale: string = "en";
  private currentLocale: string | null = null;

  // 构造函数不再做异步操作
  constructor() {}

  /**
   * 尝试从 manifest.json 读取 default_locale 字段，自动设置 defaultLocale
   */
  private async initDefaultLocaleFromManifest(): Promise<string> {
    if (typeof fetch === "undefined") return this.defaultLocale;
    try {
      // manifest.json 路径适配 popup/background/content script
      const manifestPaths = [
        "/manifest.json",
        "../manifest.json",
        "../../manifest.json",
        "/src/manifest.json",
        "../src/manifest.json",
      ];
      for (const path of manifestPaths) {
        try {
          const res = await fetch(path).catch(() => null);
          if (res && res.ok) {
            const manifest = await res.json().catch(() => null);
            if (manifest && manifest.default_locale) {
              this.defaultLocale = manifest.default_locale;
              return this.defaultLocale;
            }
          }
        } catch {}
      }
    } catch {}
    return this.defaultLocale;
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n();
    }
    return I18n.instance;
  }

  /**
   * 检测浏览器默认语言
   */
  private detectBrowserLocale(): string {
    if (typeof navigator !== "undefined" && navigator.language) {
      return navigator.language.replace("-", "_");
    }
    return this.defaultLocale;
  }

  /**
   * 加载指定 locale 的 messages.json
   */
  private async loadMessages(locale: string): Promise<LocaleMessages | null> {
    if (typeof fetch === "undefined") return null;
    try {
      const response = await fetch(`../_locales/${locale}/messages.json`).catch(
        (err) => {
          console.error("[i18n-utils] fetch error", err);
          return null;
        }
      );
      if (!response || !response.ok) {
        console.warn(
          `[i18n-utils] Failed to fetch messages.json for locale: ${locale}, response:`,
          response
        );
        return null;
      }
      try {
        return await response.json();
      } catch (jsonErr) {
        console.error(
          "[i18n-utils] Failed to parse messages.json for locale:",
          locale,
          jsonErr
        );
        return null;
      }
    } catch (err) {
      console.error(
        "[i18n-utils] Unexpected error loading messages.json for locale:",
        locale,
        err
      );
      return null;
    }
  }

  /**
   * 设置强制语言（如 config.language），下次 init 时生效
   */
  public setForcedLocale(locale: string) {
    this.forcedLocale = locale;
  }

  /**
   * 动态切换语言，只有当 locale 变化时才重新加载
   */
  public async changeLanguage(locale: string): Promise<void> {
    if (locale === this.currentLocale) return;
    this.setForcedLocale(locale);
    await this.init(true); // 传递 forceReload 标志
  }

  /**
   * 初始化国际化系统，支持 fallback 到默认语言
   * @param forceReload 是否强制重新加载（用于切换语言）
   */
  public async init(forceReload = false): Promise<void> {
    if (this.initPromise && !forceReload) return this.initPromise;
    this.initPromise = (async () => {
      try {
        await this.initDefaultLocaleFromManifest();
        let locale = null;
        if (!locale) locale = this.forcedLocale || this.detectBrowserLocale();
        this.forcedLocale = locale;
        const main = await this.loadMessages(locale);
        if (main) {
          this.loadedMessages = main;
          this.currentLocale = locale;
          console.log(
            `[i18n-utils] Loaded ${Object.keys(main).length} messages for ${locale}`
          );
        } else {
          this.loadedMessages = {};
          this.currentLocale = null;
          console.warn(
            `[i18n-utils] Failed to load locale ${locale}, fallback to default`
          );
        }
        if (locale !== this.defaultLocale) {
          const fallback = await this.loadMessages(this.defaultLocale);
          if (fallback) {
            this.fallbackMessages = fallback;
          }
        }
      } catch (error) {
        const msg =
          typeof error === "object" && error && "message" in error
            ? (error as any).message
            : String(error);
        console.warn("[i18n-utils] Initialization error:", msg);
      }
    })();
    return this.initPromise;
  }

  /**
   * 初始化本地化工具并应用到页面
   */
  public async apply(): Promise<void> {
    await this.init();
    if (typeof document !== "undefined") {
      const run = async () => await this.applyToPage();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
      } else {
        await run();
      }
    }
  }

  /**
   * 获取本地化字符串，优先 loadedMessages，其次 fallbackMessages
   */
  public getMessage(messageId: string, defaultValue?: string): string {
    if (
      this.loadedMessages[messageId] &&
      typeof this.loadedMessages[messageId].message === "string"
    ) {
      return this.loadedMessages[messageId].message;
    }
    if (
      this.fallbackMessages &&
      this.fallbackMessages[messageId] &&
      typeof this.fallbackMessages[messageId].message === "string"
    ) {
      return this.fallbackMessages[messageId].message;
    }
    // 已移除 chrome.i18n.getMessage 分支，避免 context invalidated 问题
    return defaultValue || messageId;
  }

  /**
   * 格式化消息，支持 {0}、{name} 占位符
   */
  public formatMessage(
    messageId: string,
    defaultMessage: string,
    ...args: any[]
  ): string {
    const message = this.getMessage(messageId, defaultMessage);
    if (!args.length) return message;
    let result = message;
    // 支持对象参数 {name: value}
    if (
      args.length === 1 &&
      typeof args[0] === "object" &&
      !Array.isArray(args[0])
    ) {
      const obj = args[0];
      Object.keys(obj).forEach((key) => {
        result = result.replace(
          new RegExp("\\{" + key + "\\}", "g"),
          String(obj[key])
        );
      });
    } else {
      // 支持 {0} {1} ...
      const arr = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      for (let i = 0; i < arr.length; i++) {
        result = result.replace(
          new RegExp("\\{" + i + "\\}", "g"),
          String(arr[i] ?? "")
        );
      }
    }
    return result;
  }

  /**
   * 对DOM元素应用本地化
   */
  public async applyToPage(): Promise<void> {
    if (typeof document === "undefined") return;
    // 处理页面标题
    const titleElement = document.querySelector("title[data-i18n]");
    if (titleElement) {
      const key = titleElement.getAttribute("data-i18n");
      if (key) {
        document.title = this.getMessage(key, document.title);
      }
    }
    // 处理所有带data-i18n的元素
    const i18nElements = document.querySelectorAll("[data-i18n]");
    i18nElements.forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (key) {
        const translated = this.getMessage(key);
        if (translated) {
          // 支持 data-i18n-attr 指定属性
          const attr = element.getAttribute("data-i18n-attr");
          if (attr) {
            element.setAttribute(attr, translated);
          } else {
            this.setElementContent(element, translated);
          }
        }
      }
    });
    console.debug("[i18n-utils] Applied localization to page");
  }

  /**
   * 设置元素内容，支持更多属性
   */
  private setElementContent(element: Element, message: string): void {
    switch (element.tagName) {
      case "INPUT": {
        const inputElem = element as HTMLInputElement;
        if (["submit", "button"].includes(inputElem.type)) {
          inputElem.value = message;
        } else {
          inputElem.placeholder = message;
        }
        break;
      }
      case "OPTION":
        (element as HTMLOptionElement).text = message;
        break;
      case "IMG":
        (element as HTMLImageElement).alt = message;
        break;
      default:
        if (element.hasAttribute("placeholder")) {
          element.setAttribute("placeholder", message);
        } else if (element.hasAttribute("aria-label")) {
          element.setAttribute("aria-label", message);
        } else {
          element.textContent = message;
        }
        break;
    }
  }
}

/**
 * 本地化错误类
 */
export class _Error extends Error {
  public readonly messageId: string;

  /**
   * 创建一个已本地化的错误对象
   * 所有可能暴露给用户的错误都应使用此类
   *
   * @param messageId 消息ID，用于本地化
   * @param defaultMessage 默认消息，当本地化失败时使用
   * @param args 替换参数，用于格式化消息
   */
  constructor(
    messageId: string,
    defaultMessage: string = messageId,
    ...args: any[]
  ) {
    // 使用本地化的消息作为错误消息，并格式化替换参数
    const formattedMessage = I18n.getInstance().formatMessage(
      messageId,
      defaultMessage,
      ...args
    );
    super(formattedMessage);

    this.messageId = messageId;

    // 修复原型链
    Object.setPrototypeOf(this, _Error.prototype);

    // 保留原始堆栈
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _Error);
    }
  }
}

// 保持原有 i18n 对象，但优化实现
export const i18n = {
  init: async () => await I18n.getInstance().init(),
  apply: async () => await I18n.getInstance().apply(),
  getMessage: (messageId: string, defaultMessage?: string) =>
    I18n.getInstance().getMessage(messageId, defaultMessage),
  translate: (
    messageId: string,
    defaultMessage: string,
    ...args: any[]
  ): string =>
    I18n.getInstance().formatMessage(messageId, defaultMessage, ...args),
  changeLanguage: async (locale: string) => await I18n.getInstance().changeLanguage(locale),
};

/**
 * 本地化函数 (更简洁的调用方式)
 * @param messageId 消息ID
 * @param defaultMessage 默认消息字符串，当无法找到messageId对应的消息时使用
 * @param args 用于替换消息中的{0}, {1}等占位符的参数
 * @returns 本地化后的字符串
 */
export function _(
  messageId: string,
  defaultMessage: string,
  ...args: any[]
): string {
  // 简化为直接调用实例方法
  return I18n.getInstance().formatMessage(messageId, defaultMessage, ...args);
}

// 自动初始化处理 - 保持不变
if (typeof document !== "undefined") {
  I18n.getInstance().apply();
}

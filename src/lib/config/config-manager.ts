import { Logger } from '../logger/logger.js';
import { storage } from '../storage/index.js';
import { ConfigUI, ExtractConfigValues } from './config-types.js';
import { ConfigUIRenderer } from './config-ui-renderer.js';

/**
 * 配置管理器 - 负责配置的存储、检索和更新
 */
export class ConfigManager<T extends Record<string, any>> {
  private logger: Logger;
  private defaultConfig: T;
  private userConfig: Partial<T>;
  private storageKey: string;
  private listeners = new Map<string, Array<(value: any) => void>>();
  private initialized = false;
  private uiRenderer: ConfigUIRenderer;
  private configMetadata: Record<string, ConfigUI.UIMetadata> = {};
  
  /**
   * 构造函数
   * @param defaultConfig 默认配置
   * @param storageKey 存储键名
   */
  constructor(defaultConfig: T, storageKey = 'app_config') {
    this.defaultConfig = defaultConfig;
    this.userConfig = {} as Partial<T>;
    this.storageKey = storageKey;
    this.logger = new Logger('ConfigManager');
    this.uiRenderer = new ConfigUIRenderer();
    
    // 注意：不再自动初始化，改为需要明确调用 init()
    // 这样可以控制初始化顺序
  }

  /**
   * 初始化配置管理器
   * 公开方法，供外部调用
   */
  public async init(): Promise<void> {
    this.logger.debug('初始化配置管理器');
    await this.initialize();
    this.logger.info('配置管理器初始化完成');
  }
  
  /**
   * 初始化配置系统
   * 内部方法，处理实际初始化逻辑
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // 从存储加载用户配置
      const storedConfig = await storage.get<Partial<T>>(this.storageKey);
      
      if (storedConfig) {
        this.userConfig = storedConfig;
        this.logger.debug('从存储加载配置成功');
      } else {
        this.userConfig = {} as Partial<T>;
        this.logger.debug('未找到存储的配置，使用默认值');
      }
      
      this.initialized = true;
      this.logger.debug('配置系统初始化完成');
    } catch (error) {
      this.logger.error('加载配置失败', error);
      this.userConfig = {} as Partial<T>;
      this.initialized = true; // 即使失败也标记为已初始化，使用默认配置
    }
  }
  
  /**
   * 确保配置系统已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
  
  /**
   * 获取配置值
   * @param key 配置键
   * @returns 配置值
   */
  async get<K extends keyof T>(key: K): Promise<T[K]> {
    await this.ensureInitialized();
    
    return (key in this.userConfig) 
      ? this.userConfig[key] as T[K]
      : this.defaultConfig[key];
  }
  
  /**
   * 获取所有配置
   * @returns 合并后的完整配置对象
   */
  async getAll(): Promise<T> {
    await this.ensureInitialized();
    
    // 深度合并默认配置和用户配置
    return this.deepMerge(this.defaultConfig, this.userConfig) as T;
  }
  
  /**
   * 设置配置值
   * @param key 配置键
   * @param value 新值
   */
  async set<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    await this.ensureInitialized();
    
    this.userConfig[key] = value;
    await storage.set(this.storageKey, this.userConfig);
    
    this.logger.debug(`配置已更新: ${String(key)}`);
    await this.notifyListeners(key as string, value);
  }
  
  /**
   * 批量更新配置
   * @param partialConfig 部分配置对象
   */
  async update(partialConfig: Partial<T>): Promise<void> {
    await this.ensureInitialized();
    
    // 深度合并配置
    this.userConfig = this.deepMerge(this.userConfig, partialConfig) as Partial<T>;
    
    // 保存到存储
    await storage.set(this.storageKey, this.userConfig);
    
    this.logger.debug('配置已批量更新');
    
    // 通知监听器
    for (const key in partialConfig) {
      if (Object.prototype.hasOwnProperty.call(partialConfig, key)) {
        await this.notifyListeners(key, partialConfig[key]);
      }
    }
  }
  
  /**
   * 重置所有配置为默认值
   */
  async reset(): Promise<void> {
    this.userConfig = {} as Partial<T>;
    await storage.set(this.storageKey, this.userConfig);
    
    this.logger.debug('所有配置已重置为默认值');
    
    // 通知所有监听器
    for (const key of this.listeners.keys()) {
      const value = this.getValueByPath(this.defaultConfig, key);
      await this.notifyListeners(key, value);
    }
  }
  
  /**
   * 监听配置变化
   * @param key 配置路径（支持点分隔，如 'logging.level'）
   * @param listener 监听器函数
   */
  onChange(key: string, listener: (value: any) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    
    this.listeners.get(key)!.push(listener);
    
    // 返回取消监听的函数
    return () => {
      const listeners = this.listeners.get(key);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }
  
  /**
   * 通知配置监听器
   */
  private async notifyListeners(key: string, value: any): Promise<void> {
    // 处理确切的路径匹配
    if (this.listeners.has(key)) {
      for (const listener of this.listeners.get(key)!) {
        try {
          await Promise.resolve(listener(value));
        } catch (error) {
          this.logger.error(`执行配置监听器失败: ${key}`, error);
        }
      }
    }
    
    // 处理路径前缀匹配（如通知 'logging' 当 'logging.level' 变化时）
    for (const registeredPath of this.listeners.keys()) {
      if (key.startsWith(`${registeredPath}.`)) {
        const nestedKey = key.substring(registeredPath.length + 1);
        const nestedValue = value[nestedKey];
        
        for (const listener of this.listeners.get(registeredPath)!) {
          try {
            await Promise.resolve(listener({[nestedKey]: nestedValue}));
          } catch (error) {
            this.logger.error(`执行配置监听器失败: ${registeredPath}`, error);
          }
        }
      }
    }
  }
  
  /**
   * 设置配置UI元数据
   */
  setUIMetadata(metadata: Record<string, ConfigUI.UIMetadata>): void {
    this.configMetadata = metadata;
  }
  
  /**
   * 渲染配置UI
   * @param container 容器元素
   * @param options 渲染选项
   */
  async renderUI(
    container: HTMLElement,
    options: Partial<Omit<ConfigUI.RenderOptions, 'container'>> = {}
  ): Promise<void> {
    await this.ensureInitialized();
    
    if (Object.keys(this.configMetadata).length === 0) {
      this.logger.warn('尝试渲染UI但未设置元数据');
      return;
    }
    
    const currentConfig = await this.getAll();
    
    // 创建完整的渲染选项
    const renderOptions: ConfigUI.RenderOptions = {
      container,
      onChange: options.onChange,
      showSaveButton: options.showSaveButton ?? true,
      showResetButton: options.showResetButton ?? true,
      
      // 默认的保存处理程序
      onSave: options.onSave || (async () => {
        // 指定正确的泛型类型
        const values = this.uiRenderer.collectConfigValues<T>();
        await this.update(values);
      }),
      
      // 默认的重置处理程序
      onReset: options.onReset || (async () => {
        await this.reset();
        await this.updateUI();
      })
    };
    
    this.uiRenderer.renderConfigUI(this.configMetadata, currentConfig, renderOptions);
  }
  
  /**
   * 更新UI以反映当前配置值
   */
  async updateUI(): Promise<void> {
    const currentConfig = await this.getAll();
    this.uiRenderer.updateUIValues(currentConfig);
  }
  
  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }
  
  /**
   * 判断是否为对象
   */
  private isObject(item: any): boolean {
    return item !== null && typeof item === 'object' && !Array.isArray(item);
  }
  
  /**
   * 通过路径获取嵌套属性
   */
  private getValueByPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    
    return current;
  }
}
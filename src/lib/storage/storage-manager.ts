import { Logger } from "../logger/logger.js";
import {
  StorageAdapter,
  StorageKey,
  StorageItem,
  StorageOptions,
  StorageItemOptions,
  StorageChangeEvent,
  StorageEventHandler,
  StorageChangeType,
  StorageSerializer,
} from "./storage-types.js";
import { JsonSerializer } from "./serializers/json-serializer.js";
import { StorageStrategy, StorageBackendType } from "./storage-strategy.js";

/**
 * 存储管理器 - 提供统一的存储接口
 */
export class StorageManager {
  private adapter: StorageAdapter | null = null;
  private strategy: StorageStrategy | null = null;
  private namespace: string;
  private defaultExpirationTime: number | undefined;
  private serializer: StorageSerializer;
  private logger: Logger;
  private initPromise: Promise<void> | null = null;
  private initialized: boolean = false;
  private eventHandlers: Map<string, Set<StorageEventHandler>> = new Map();

  /**
   * 构造函数
   * @param adapterOrStrategy 存储适配器或存储策略
   * @param options 存储选项
   */
  constructor(
    adapterOrStrategy: StorageAdapter | StorageStrategy,
    options: StorageOptions = {}
  ) {
    if (adapterOrStrategy instanceof StorageStrategy) {
      this.strategy = adapterOrStrategy;
    } else {
      this.adapter = adapterOrStrategy;
    }

    this.namespace = options.namespace || "app";
    this.defaultExpirationTime = options.defaultExpirationTime;
    this.serializer = options.serializer || new JsonSerializer();
    this.logger = options.logger || new Logger("StorageManager");

    // 初始化
    this.initPromise = this.initialize();
  }

  /**
   * 显式初始化存储管理器
   * 如果已经初始化或正在初始化中，则返回相应的Promise
   */
  public async init(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initialize();

    try {
      await this.initPromise;
      this.initialized = true;
      this.logger.info("存储系统初始化完成");
    } catch (error) {
      this.logger.error("存储系统初始化失败", error);
      // 重置初始化状态以允许重试
      this.initPromise = null;
      throw error;
    }

    return this.initPromise;
  }

  /**
   * 初始化存储管理器
   */
  private async initialize(): Promise<void> {
    try {
      // 如果使用策略，从策略获取适配器
      if (this.strategy) {
        this.adapter = await this.strategy.getAdapter();
      }

      // 确保适配器可用
      if (!this.adapter) {
        throw new Error("存储适配器不可用");
      }

      const isAvailable = await this.adapter.isAvailable();
      if (!isAvailable) {
        throw new Error(`存储适配器不可用: ${this.adapter.constructor.name}`);
      }

      this.initialized = true;
    } catch (error) {
      this.logger.error("初始化存储失败:", error);
      throw error;
    }
  }

  /**
   * 确保管理器已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * 切换到特定的存储后端
   * @param backendType 后端类型
   */
  async switchBackend(backendType: StorageBackendType): Promise<boolean> {
    if (!this.strategy) {
      throw new Error("当前存储管理器未使用策略模式，无法切换后端");
    }

    try {
      const newAdapter = await this.strategy.getAdapter(backendType);
      if (!newAdapter) {
        return false;
      }

      this.adapter = newAdapter;
      return true;
    } catch (error) {
      this.logger.error(`切换存储后端失败: ${backendType}`, error);
      return false;
    }
  }

  /**
   * 获取当前使用的适配器类型
   */
  getAdapterType(): string {
    if (!this.adapter) {
      return "none";
    }
    return this.adapter.constructor.name;
  }

  /**
   * 获取带命名空间的键
   * @param key 原始键
   */
  private getNamespacedKey(key: StorageKey): StorageKey {
    return `${this.namespace}:${key}`;
  }

  /**
   * 设置存储项
   * @param key 键
   * @param data 数据
   * @param options 选项
   */
  async set<T>(
    key: StorageKey,
    data: T,
    options: StorageItemOptions = {}
  ): Promise<void> {
    await this.ensureInitialized();
    try {
      const namespacedKey = this.getNamespacedKey(key);

      // 检查是否存在旧值，用于事件通知
      const oldValue = await this.get<T>(key);
      const changeType: StorageChangeType =
        oldValue === null ? "create" : "update";

      // 创建存储项
      const item: StorageItem<T> = {
        data,
        meta: {
          updatedAt: Date.now(),
          version: options.version || 1,
          expiresIn: options.expiresIn || this.defaultExpirationTime,
        },
      };

      // 使用序列化器处理整个存储项
      const serializedItem = this.serializer.serialize(item);

      // 将序列化后的数据传递给适配器
      await this.adapter!.set(namespacedKey, serializedItem);
      this.logger.debug(`存储项已设置: ${key}`);

      // 触发事件
      this.emitChange({
        key,
        type: changeType,
        oldValue,
        newValue: data,
        namespace: this.namespace,
      });
    } catch (error) {
      this.logger.error(`设置存储项失败: ${key}`, error);
      throw error;
    }
  }

  /**
   * 获取存储项
   * @param key 键
   * @param defaultValue 默认值
   */
  async get<T>(
    key: StorageKey,
    defaultValue: T | null = null
  ): Promise<T | null> {
    await this.ensureInitialized();
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const serializedItem = await this.adapter!.get<string>(namespacedKey);

      if (!serializedItem) {
        return defaultValue;
      }

      // 反序列化存储项
      const item = this.serializer.deserialize<StorageItem<T>>(serializedItem);

      // 检查是否过期
      if (item.meta.expiresIn) {
        const expirationTime = item.meta.updatedAt + item.meta.expiresIn;
        if (Date.now() > expirationTime) {
          this.logger.debug(`存储项已过期: ${key}`);
          await this.remove(key);
          return defaultValue;
        }
      }

      return item.data;
    } catch (error) {
      this.logger.error(`获取存储项失败: ${key}`, error);
      return defaultValue;
    }
  }

  /**
   * 删除存储项
   * @param key 键
   */
  async remove(key: StorageKey): Promise<void> {
    await this.ensureInitialized();
    try {
      // 获取旧值用于事件通知
      const oldValue = await this.get(key);

      const namespacedKey = this.getNamespacedKey(key);
      await this.adapter!.remove(namespacedKey);
      this.logger.debug(`存储项已删除: ${key}`);

      // 触发事件
      this.emitChange({
        key,
        type: "delete",
        oldValue,
        namespace: this.namespace,
      });
    } catch (error) {
      this.logger.error(`删除存储项失败: ${key}`, error);
      throw error;
    }
  }

  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.adapter!.clear();
      this.logger.debug("存储已清空");

      // 触发事件
      this.emitChange({
        key: null,
        type: "clear",
        namespace: this.namespace,
      });
    } catch (error) {
      this.logger.error("清空存储失败", error);
      throw error;
    }
  }

  /**
   * 获取所有键
   */
  async keys(): Promise<StorageKey[]> {
    await this.ensureInitialized();
    try {
      const allKeys = await this.adapter!.keys();
      const prefix = `${this.namespace}:`;

      // 过滤并移除命名空间前缀
      return allKeys
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    } catch (error) {
      this.logger.error("获取存储键失败", error);
      return [];
    }
  }

  /**
   * 检查键是否存在
   * @param key 键
   */
  async has(key: StorageKey): Promise<boolean> {
    await this.ensureInitialized();
    try {
      const namespacedKey = this.getNamespacedKey(key);
      return await this.adapter!.has(namespacedKey);
    } catch (error) {
      this.logger.error(`检查存储项失败: ${key}`, error);
      return false;
    }
  }

  /**
   * 注册存储变更事件处理器
   * @param eventType 事件类型，如 'create', 'update', 'delete', 'clear' 或 '*' 表示所有事件
   * @param handler 事件处理器
   */
  on<T = any>(
    eventType: StorageChangeType | "*",
    handler: StorageEventHandler<T>
  ): () => void {
    const eventKey = eventType === "*" ? "all" : eventType;

    if (!this.eventHandlers.has(eventKey)) {
      this.eventHandlers.set(eventKey, new Set());
    }

    this.eventHandlers.get(eventKey)!.add(handler);

    // 返回注销函数
    return () => {
      if (this.eventHandlers.has(eventKey)) {
        this.eventHandlers.get(eventKey)!.delete(handler);
      }
    };
  }

  /**
   * 触发存储变更事件
   * @param event 事件对象
   */
  private emitChange<T = any>(event: StorageChangeEvent<T>): void {
    // 触发特定类型的处理器
    const typeHandlers = this.eventHandlers.get(event.type);
    if (typeHandlers) {
      typeHandlers.forEach((handler) => handler(event));
    }

    // 触发通用处理器
    const allHandlers = this.eventHandlers.get("all");
    if (allHandlers) {
      allHandlers.forEach((handler) => handler(event));
    }
  }

  /**
   * 批量获取多个键的值
   * @param keys 要获取的键数组
   * @returns 键值对的对象，未找到的键值为 null
   */
  public async getMany<T>(
    keys: StorageKey[]
  ): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};

    // 检查初始化状态
    await this.ensureInitialized();

    // 生成命名空间键
    const namespacedKeys = keys.map((key) => this.getNamespacedKey(key));

    // 优先使用适配器的批量方法(如果存在)
    if (this.adapter && typeof this.adapter.getMany === "function") {
      const serializedItems = await this.adapter.getMany<string>(
        namespacedKeys
      );

      // 将结果转换回用户键空间
      keys.forEach((key, index) => {
        const namespacedKey = namespacedKeys[index];
        const serializedItem = serializedItems[namespacedKey];

        if (serializedItem) {
          try {
            // 反序列化存储项
            const item =
              this.serializer.deserialize<StorageItem<T>>(serializedItem);

            // 检查是否过期
            if (item.meta && item.meta.expiresIn) {
              const expirationTime = item.meta.updatedAt + item.meta.expiresIn;
              if (Date.now() > expirationTime) {
                this.logger.debug(`存储项已过期: ${key}`);
                this.remove(key).catch((error) =>
                  this.logger.error(`移除过期项时出错: ${key}`, error)
                );
                result[key] = null;
              } else {
                result[key] = item.data;
              }
            } else {
              result[key] = item.data;
            }
          } catch (error) {
            this.logger.error(`反序列化存储项失败: ${key}`, error);
            result[key] = null;
          }
        } else {
          result[key] = null;
        }
      });

      return result;
    }

    // 回退到并行单个获取
    await Promise.all(
      keys.map(async (key) => {
        result[key] = await this.get<T>(key);
      })
    );

    return result;
  }

  /**
   * 批量设置多个键值对
   * @param items 要设置的键值对对象
   * @param options 可选的存储选项
   */
  public async setMany<T>(
    items: Record<StorageKey, T>,
    options: StorageItemOptions = {}
  ): Promise<void> {
    // 检查初始化状态
    await this.ensureInitialized();

    // 为批量操作准备数据
    const namespacedItems: Record<string, any> = {};
    const changeEvents: StorageChangeEvent[] = [];

    // 为每个键值对准备数据和变更事件
    await Promise.all(
      Object.entries(items).map(async ([key, value]) => {
        const namespacedKey = this.getNamespacedKey(key);
        const exists = await this.has(key);
        const oldValue = exists ? await this.get(key) : null;

        // 创建存储项
        const item: StorageItem<T> = {
          data: value,
          meta: {
            updatedAt: Date.now(),
            version: options.version || 1,
            expiresIn: options.expiresIn || this.defaultExpirationTime,
          },
        };

        // 序列化存储项
        const serializedItem = this.serializer.serialize(item);
        namespacedItems[namespacedKey] = serializedItem;

        // 准备变更事件
        changeEvents.push({
          key,
          type: exists ? "update" : "create",
          oldValue,
          newValue: value,
          namespace: this.namespace,
        });
      })
    );

    // 优先使用适配器的批量方法(如果存在)
    if (this.adapter && typeof this.adapter.setMany === "function") {
      await this.adapter.setMany(namespacedItems);

      // 批量触发所有变更事件
      changeEvents.forEach((event) => this.emitChange(event));

      return;
    }

    // 回退到并行单个设置
    await Promise.all(
      Object.entries(items).map(([key, value]) => this.set(key, value, options))
    );
  }

  /**
   * 批量删除多个键
   * @param keys 要删除的键数组
   */
  public async removeMany(keys: StorageKey[]): Promise<void> {
    // 检查初始化状态
    await this.ensureInitialized();

    // 收集旧值用于事件通知
    const oldValues: Record<string, any> = {};
    await Promise.all(
      keys.map(async (key) => {
        oldValues[key] = await this.get(key);
      })
    );

    // 生成命名空间键
    const namespacedKeys = keys.map((key) => this.getNamespacedKey(key));

    // 优先使用适配器的批量方法(如果存在)
    if (this.adapter && typeof this.adapter.removeMany === "function") {
      await this.adapter.removeMany(namespacedKeys);

      // 触发批量删除事件
      keys.forEach((key) => {
        this.emitChange({
          key,
          type: "delete",
          oldValue: oldValues[key],
          namespace: this.namespace,
        });
      });

      return;
    }

    // 回退到并行单个删除
    await Promise.all(keys.map((key) => this.remove(key)));
  }
}

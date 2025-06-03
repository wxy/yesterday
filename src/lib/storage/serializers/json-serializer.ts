import { StorageSerializer } from '../storage-types.js';

/**
 * JSON序列化器
 */
export class JsonSerializer implements StorageSerializer {
  /**
   * 序列化数据
   */
  serialize<T>(data: T): string {
    return JSON.stringify(data);
  }
  
  /**
   * 反序列化数据
   */
  deserialize<T>(data: string): T {
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      throw new Error(`[JSON序列化] 反序列化失败: ${e instanceof Error ? e.message : e}, 原始内容: ${data}`);
    }
  }
}
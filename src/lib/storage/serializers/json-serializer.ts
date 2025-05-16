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
    return JSON.parse(data) as T;
  }
}
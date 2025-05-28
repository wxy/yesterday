import { ConfigUI } from './config-types.js';

/**
 * 配置项定义的类型
 */
interface ConfigDefinitionItem<T = any> {
  type: (...args: any[]) => T;
  default: T;
  ui: ConfigUI.UIMetadata;
}

/**
 * 配置项定义 - 仅保留 API 请求超时和 AI 设置
 */
export const configs: Record<string, ConfigDefinitionItem> = {
  // ===== API 请求超时 =====
  'advanced.requestTimeout': {
    type: Number,
    default: 10000, // 10秒，毫秒
    ui: {
      type: 'number',
      label: 'API请求超时 (秒)',
      description: '设置网络请求的超时时间',
      section: '高级设置',
      min: 1,
      max: 60,
      converter: (seconds: number) => seconds * 1000, // 转换为毫秒
      reverter: (ms: number) => Math.floor(ms / 1000) // 毫秒转换为秒
    } as ConfigUI.NumberUIMetadata
  },

  // ===== AI 设置 =====
  'aiServiceConfigs': {
    type: Array as unknown as () => AiServiceConfig[],
    default: [
      { serviceId: 'ollama' }
    ],
    ui: {
      type: 'hidden'
    } as any // 仅数据存储，不渲染
  },
  'aiServiceConfig': {
    type: Object as unknown as () => AiServiceConfig,
    default: { serviceId: 'ollama' },
    ui: {
      type: 'group',
      label: '当前 AI 服务配置',
      description: '当前激活的 AI 服务配置，切换/编辑后自动同步到配置列表。',
      section: 'AI 设置',
      controller: 'serviceId', // 声明主从关系
      fields: [
        { key: 'serviceId', type: 'select', label: '服务类型', options: [
          { value: 'ollama', label: 'Ollama 本地' },
          { value: 'chrome-ai', label: 'Chrome 内置 AI' },
          { value: 'openai', label: 'OpenAI' },
          { value: 'other', label: '其它' }
        ] },
        { key: 'model', type: 'text', label: '模型名称', description: '如 llama2, gpt-3.5-turbo 等', condition: "aiServiceConfig.serviceId !== 'ollama' && aiServiceConfig.serviceId !== 'chrome-ai'" },
        { key: 'url', type: 'text', label: 'API 地址', description: '自定义服务地址（如本地或企业 API）', condition: "aiServiceConfig.serviceId !== 'ollama' && aiServiceConfig.serviceId !== 'chrome-ai'" },
        { key: 'apiKey', type: 'password', label: 'API Key', description: '如需鉴权请填写', condition: "aiServiceConfig.serviceId !== 'ollama' && aiServiceConfig.serviceId !== 'chrome-ai'" }
      ]
    } as any // 兼容 group 类型
  }
};

/**
 * 配置定义类型
 */
export type ConfigDefinition = typeof configs;

/**
 * 配置模式类型（根据配置定义自动生成）
 */
export type ConfigSchema = {
  [K in keyof ConfigDefinition]: K extends `${infer Section}.${infer Key}`
    ? { [S in Section]: { [P in Key]: ReturnType<ConfigDefinition[K]['type']> } }[Section]
    : never;
};

/**
 * AI 服务配置类型
 */
export interface AiServiceConfig {
  serviceId: string;
  model?: string;
  url?: string;
  apiKey?: string;
  [key: string]: any;
}
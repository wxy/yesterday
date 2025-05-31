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
  // ===== 常规设置 =====
  'requestTimeout': {
    type: Number,
    default: 60000, // 60秒，毫秒
    ui: {
      type: 'number',
      label: 'API请求超时 (秒)',
      description: '设置网络请求的超时时间',
      section: '常规设置',
      min: 1,
      max: 60,
      converter: (seconds: number) => seconds * 1000, // 转换为毫秒
      reverter: (ms: number) => Math.floor(ms / 1000) // 毫秒转换为秒
    } as ConfigUI.NumberUIMetadata
  },
  'maxAIResultLength': {
    type: Number,
    default: 2048,
    ui: {
      type: 'number',
      label: 'AI分析结果最大长度',
      description: '限制AI分析结果的最大字符数，防止内容过长影响体验',
      section: '常规设置',
      min: 256,
      max: 10000,
      step: 1
    } as ConfigUI.NumberUIMetadata
  },

  // ===== AI 服务配置 =====
  'aiServiceConfig': {
    type: Object as unknown as () => AiServiceConfig,
    default: { serviceId: 'ollama' },
    ui: {
      type: 'group',
      label: 'AI服务配置',
      description: '当前激活的 AI 服务配置，切换/编辑后自动同步到配置列表。',
      section: 'AI 服务',
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
  },

  // ===== 网址过滤 =====
  'urlFilterGroup': {
    type: Object as unknown as () => any,
    default: {
      excludeTypes: ['intranet', 'ip', 'port', 'auth'],
      excludeUrls: [],
      includeUrls: []
    },
    ui: {
      type: 'group',
      label: '网址过滤',
      description: '可灵活配置哪些网址不分析或强制分析',
      section: '网址过滤',
      fields: [
        {
          key: 'excludeTypes',
          type: 'checkbox',
          label: '排除类型',
          description: '选择需要自动排除分析的网址类型',
          options: [
            { value: 'intranet', label: '内网地址（如 10.x/192.168.x/172.16-31.x/localhost）' },
            { value: 'ip', label: '纯IP地址' },
            { value: 'port', label: '非标准端口' },
            { value: 'auth', label: '需要基础认证的网址' }
          ]
        },
        {
          key: 'excludeUrls',
          type: 'text',
          label: '手动排除网址',
          description: '每行一个，支持通配符/正则表达式，匹配到的将不会进行AI分析。',
          rows: 4
        },
        {
          key: 'includeUrls',
          type: 'text',
          label: '强制分析网址',
          description: '每行一个，支持通配符/正则表达式，优先于排除规则。',
          rows: 4
        }
      ]
    } as any
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
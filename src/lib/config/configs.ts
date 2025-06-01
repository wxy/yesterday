import { ConfigUI } from './config-types.js';
import { _ } from '../i18n/i18n.js';

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
      label: _('config_request_timeout_label', 'API 请求超时 (秒)'),
      description: _('config_request_timeout_desc', '设置网络请求的超时时间'),
      section: _('config_section_general', '常规设置'),
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
      label: _('config_max_ai_result_length_label', 'AI 分析结果最大长度'),
      description: _('config_max_ai_result_length_desc', '限制 AI 分析结果的最大字符数，防止内容过长影响体验'),
      section: _('config_section_general', '常规设置'),
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
      label: _('config_ai_service_label', 'AI服务配置'),
      description: _('config_ai_service_desc', '当前激活的 AI 服务配置，切换/编辑后自动同步到配置列表。'),
      section: _('config_section_ai', 'AI 服务'),
      fields: [
        { key: 'serviceId', type: 'select', label: _('config_ai_service_type_label', '服务类型'), options: [
          { value: 'ollama', label: _('config_ai_service_ollama', 'Ollama 本地') },
          { value: 'chrome-ai', label: _('config_ai_service_chrome_ai', 'Chrome 内置 AI') },
          { value: 'openai', label: _('config_ai_service_openai', 'OpenAI') },
          { value: 'other', label: _('config_ai_service_other', '其它') }
        ] },
        { key: 'model', type: 'text', label: _('config_ai_model_label', '模型名称'), description: _('config_ai_model_desc', '如 llama2, gpt-3.5-turbo 等'), condition: "aiServiceConfig.serviceId !== 'ollama' && aiServiceConfig.serviceId !== 'chrome-ai'" },
        { key: 'url', type: 'text', label: _('config_ai_url_label', 'API 地址'), description: _('config_ai_url_desc', '自定义服务地址（如本地或企业 API）'), condition: "aiServiceConfig.serviceId !== 'ollama' && aiServiceConfig.serviceId !== 'chrome-ai'" },
        { key: 'apiKey', type: 'password', label: _('config_ai_apikey_label', 'API 密钥'), description: _('config_ai_apikey_desc', '如需鉴权请填写'), condition: "aiServiceConfig.serviceId !== 'ollama' && aiServiceConfig.serviceId !== 'chrome-ai'" }
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
      label: _('config_url_filter_label', '网址过滤'),
      description: _('config_url_filter_desc', '可灵活配置哪些网址不分析或强制分析'),
      section: _('config_section_url_filter', '网址过滤'),
      fields: [
        {
          key: 'excludeTypes',
          type: 'checkbox',
          label: _('config_url_filter_exclude_types_label', '排除类型'),
          description: _('config_url_filter_exclude_types_desc', '选择需要自动排除分析的网址类型'),
          options: [
            { value: 'intranet', label: _('config_url_filter_intranet', '内网地址（如 10.x/192.168.x/172.16-31.x/localhost）') },
            { value: 'ip', label: _('config_url_filter_ip', '纯IP地址') },
            { value: 'port', label: _('config_url_filter_port', '非标准端口') },
            { value: 'auth', label: _('config_url_filter_auth', '需要基础认证的网址') }
          ]
        },
        {
          key: 'excludeUrls',
          type: 'text',
          label: _('config_url_filter_exclude_urls_label', '手动排除网址'),
          description: _('config_url_filter_exclude_urls_desc', '每行一个，支持通配符/正则表达式，匹配到的将不会进行AI分析。'),
          rows: 4
        },
        {
          key: 'includeUrls',
          type: 'text',
          label: _('config_url_filter_include_urls_label', '强制分析网址'),
          description: _('config_url_filter_include_urls_desc', '每行一个，支持通配符/正则表达式，优先于排除规则。'),
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
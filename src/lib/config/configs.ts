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
 * 配置项定义 - 集成类型定义、默认值和UI元数据
 * 添加新配置时只需在此文件中添加一个新条目
 */
// 明确指定 configs 是一个字符串索引对象
export const configs: Record<string, ConfigDefinitionItem> = {
  // ===== 一般设置 =====
  'general.showStartupTips': {
    type: Boolean,
    default: true,
    ui: {
      type: 'checkbox',
      label: '启动时显示提示',
      description: '每次启动扩展时显示使用提示',
      section: '常规设置'
    } as ConfigUI.CheckboxUIMetadata
  },
  
  'general.defaultPopupPage': {
    type: String,
    default: 'home',
    ui: {
      type: 'select',
      label: '默认弹出页面',
      description: '点击扩展图标时显示的默认页面',
      section: '常规设置',
      options: [
        { value: 'home', label: '首页' },
        { value: 'search', label: '搜索' },
        { value: 'settings', label: '设置' }
      ]
    } as ConfigUI.SelectUIMetadata
  },
  
  'general.dataPeriod': {
    type: Number,
    default: 30,
    ui: {
      type: 'number',
      label: '数据保存周期 (天)',
      description: '指定数据在本地存储中保留的天数',
      section: '常规设置',
      min: 1,
      max: 365
    } as ConfigUI.NumberUIMetadata
  },
  
  // ===== 外观设置 =====
  'appearance.theme': {
    type: String as unknown as () => 'light' | 'dark' | 'system',
    default: 'system',
    ui: {
      type: 'select',
      label: '主题',
      description: '选择扩展的显示主题',
      section: '外观设置',
      options: [
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' },
        { value: 'system', label: '跟随系统' }
      ]
    } as ConfigUI.SelectUIMetadata
  },
  
  'appearance.iconColor': {
    type: String,
    default: '#4285F4',
    ui: {
      type: 'color',
      label: '图标颜色',
      description: '自定义扩展图标的颜色',
      section: '外观设置'
    } as ConfigUI.ColorUIMetadata
  },
  
  'appearance.fontSize': {
    type: Number,
    default: 16,
    ui: {
      type: 'number',
      label: '字体大小 (px)',
      description: '设置界面文字大小',
      section: '外观设置',
      min: 12,
      max: 24
    } as ConfigUI.NumberUIMetadata
  },
  
  // ===== 通知设置 =====
  'notifications.enabled': {
    type: Boolean,
    default: true,
    ui: {
      type: 'checkbox',
      label: '启用通知',
      description: '当重要事件发生时显示通知',
      section: '通知设置'
    } as ConfigUI.CheckboxUIMetadata
  },
  
  'notifications.sound': {
    type: Boolean,
    default: true,
    ui: {
      type: 'checkbox',
      label: '通知声音',
      description: '通知时播放提示音',
      section: '通知设置',
      condition: 'notifications.enabled === true'
    } as ConfigUI.CheckboxUIMetadata
  },
  
  'notifications.duration': {
    type: Number,
    default: 5000, // 5秒，存储为毫秒
    ui: {
      type: 'number',
      label: '通知持续时间 (秒)',
      description: '设置通知显示的时长',
      section: '通知设置',
      min: 1,
      max: 30,
      step: 1,
      converter: (seconds: number) => seconds * 1000, // 转换为毫秒
      reverter: (ms: number) => Math.floor(ms / 1000), // 毫秒转换为秒
      condition: 'notifications.enabled === true'
    } as ConfigUI.NumberUIMetadata
  },

  // ===== 存储设置 =====
  'storage.syncEnabled': {
    type: Boolean,
    default: false,
    ui: {
      type: 'checkbox',
      label: '启用跨设备数据同步',
      description: '在您登录的所有设备间同步配置（需要Google账户）',
      section: '存储设置'
    } as ConfigUI.CheckboxUIMetadata
  },
  
  'storage.expirationTime': {
    type: Number,
    default: 30 * 60 * 1000, // 30分钟，毫秒
    ui: {
      type: 'number',
      label: '缓存过期时间 (分钟)',
      description: '设置数据缓存的过期时间',
      section: '存储设置',
      min: 1,
      max: 1440,
      converter: (minutes: number) => minutes * 60 * 1000, // 转换为毫秒
      reverter: (ms: number) => Math.floor(ms / (60 * 1000)) // 毫秒转换为分钟
    } as ConfigUI.NumberUIMetadata
  },

  // ===== 日志设置 =====
  'logging.level': {
    type: String as unknown as () => 'debug' | 'info' | 'warn' | 'error',
    default: 'info',
    ui: {
      type: 'select',
      label: '日志级别',
      description: '设置日志记录的详细级别',
      section: '日志设置',
      options: [
        { value: 'debug', label: '调试 (Debug)' },
        { value: 'info', label: '信息 (Info)' },
        { value: 'warn', label: '警告 (Warning)' },
        { value: 'error', label: '错误 (Error)' }
      ]
    } as ConfigUI.SelectUIMetadata
  },
  
  'logging.console': {
    type: Boolean,
    default: true,
    ui: {
      type: 'checkbox',
      label: '控制台日志',
      description: '在开发者控制台显示日志',
      section: '日志设置'
    } as ConfigUI.CheckboxUIMetadata
  },
  
  // ===== 高级设置 =====
  'advanced.debugMode': {
    type: Boolean,
    default: false,
    ui: {
      type: 'checkbox',
      label: '调试模式',
      description: '启用额外的调试功能和日志',
      section: '高级设置'
    } as ConfigUI.CheckboxUIMetadata
  },
  
  'advanced.collectStats': {
    type: Boolean,
    default: false,
    ui: {
      type: 'checkbox',
      label: '匿名使用统计',
      description: '帮助改进扩展功能（不收集个人信息）',
      section: '高级设置'
    } as ConfigUI.CheckboxUIMetadata
  },
  
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
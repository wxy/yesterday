/**
 * 配置UI元数据类型定义
 */
export namespace ConfigUI {
  // UI控件类型
  export type ControlType = 'checkbox' | 'select' | 'number' | 'text' | 'color' | 'radio' | 'group' | 'password' | 'hidden';
  
  // 基础UI元数据
  export interface BaseUIMetadata {
    type: ControlType;
    label: string;
    description?: string;
    section: string;
    order?: number; // 排序顺序
    condition?: string; // 条件表达式，何时显示此选项
    path?: string; // 添加可选的path属性，用于内部处理
  }
  
  // 复选框特定属性
  export interface CheckboxUIMetadata extends BaseUIMetadata {
    type: 'checkbox';
    checkboxLabel?: string; // 复选框旁边显示的文本
  }
  
  // 下拉选择框特定属性
  export interface SelectUIMetadata extends BaseUIMetadata {
    type: 'select';
    options: Array<{ value: string; label: string }>;
  }
  
  // 数字输入框特定属性
  export interface NumberUIMetadata extends BaseUIMetadata {
    type: 'number';
    min?: number;
    max?: number;
    step?: number;
    converter?: (displayValue: number) => any; // 显示值到存储值的转换
    reverter?: (storedValue: any) => number;  // 存储值到显示值的转换
  }
  
  // 文本输入框特定属性
  export interface TextUIMetadata extends BaseUIMetadata {
    type: 'text';
    placeholder?: string;
    pattern?: string;
  }
  
  // 颜色选择器特定属性
  export interface ColorUIMetadata extends BaseUIMetadata {
    type: 'color';
    defaultValue?: string;
  }
  
  // 单选框特定属性
  export interface RadioUIMetadata extends BaseUIMetadata {
    type: 'radio';
    options: Array<{ value: string; label: string }>;
    inline?: boolean; // 是否内联显示
  }

  // group 分组表单特定属性
  export interface GroupUIMetadata extends BaseUIMetadata {
    type: 'group';
    fields: Array<any>; // 字段数组，递归支持 group
  }

  // 密码输入框特定属性
  export interface PasswordUIMetadata extends BaseUIMetadata {
    type: 'password';
    placeholder?: string;
  }

  // 隐藏控件类型（仅用于数据存储，不渲染）
  export interface HiddenUIMetadata extends BaseUIMetadata {
    type: 'hidden';
  }

  // 所有UI元数据类型的联合
  export type UIMetadata = 
    | CheckboxUIMetadata 
    | SelectUIMetadata 
    | NumberUIMetadata 
    | TextUIMetadata
    | ColorUIMetadata
    | RadioUIMetadata
    | GroupUIMetadata
    | PasswordUIMetadata
    | HiddenUIMetadata;
  
  // 配置项类型（值+UI元数据）
  export interface ConfigItem<T> {
    value: T;
    ui: UIMetadata;
  }
  
  // UI渲染配置
  export interface RenderOptions {
    container: HTMLElement;
    onChange?: (path: string, value: any) => void;
    showSaveButton?: boolean;
    showResetButton?: boolean;
    onSave?: () => Promise<void>;
    onReset?: () => Promise<void>;
  }
}

/**
 * 从配置定义中提取值类型
 */
export type ExtractConfigValues<T> = {
  [K in keyof T]: T[K] extends Record<string, any>
    ? ExtractConfigValues<T[K]>
    : T[K] extends ConfigUI.ConfigItem<infer V> ? V : T[K]
};
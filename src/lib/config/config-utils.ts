import { ConfigUI } from './config-types.js';
import { getConfigDefs, ConfigDefs, ConfigSchema } from './configs.js';
import { Logger } from '../logger/logger.js';

const logger = new Logger('ConfigUtils');

/**
 * 从配置定义中提取默认配置
 */
export function getDefaultConfig(): ConfigSchema {
  const defaultConfig: Record<string, any> = {};
  const configDefs = getConfigDefs();
  for (const path in configDefs) {
    const config = configDefs[path];
    setPathValue(defaultConfig, path, config.default);
  }
  return defaultConfig as unknown as ConfigSchema;
}

/**
 * 从配置定义中提取UI元数据（保留 group 类型结构，不递归扁平化 fields）
 */
export function getConfigUIMetadata(): Record<string, ConfigUI.UIMetadata> {
  const metadata: Record<string, ConfigUI.UIMetadata> = {};
  const configDefs = getConfigDefs();
  for (const path in configDefs) {
    // 只保留顶层配置项，group 类型直接输出 group 元数据
    metadata[path] = { ...configDefs[path].ui, path };
  }
  return metadata;
}

/**
 * 根据路径设置对象属性值
 */
function setPathValue(obj: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;
  
  // 创建或导航到嵌套对象
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  
  // 设置最终值
  current[parts[parts.length - 1]] = value;
}

/**
 * 验证配置完整性
 * 检查配置定义是否完整且一致
 */
export function validateConfigs(): void {
  const configDefs = getConfigDefs();
  // 检查路径格式
  const invalidPaths = Object.keys(configDefs).filter(path => !path.includes('.'));
  if (invalidPaths.length > 0) {
    logger.warn('config_invalid_path_format', '发现无效的配置路径格式: {0}', invalidPaths.join(','));
    logger.warn('config_path_should_use_dot', '配置路径应使用点分隔符，例如: "section.key"');
  }
  // 检查路径分组
  const sections = new Set<string>();
  Object.keys(configDefs).forEach(path => {
    const section = path.split('.')[0];
    sections.add(section);
  });
  // 检查UI部分
  const missingUIFields = [];
  for (const path in configDefs) {
    const ui = configDefs[path as keyof typeof configDefs].ui;
    if (!ui) {
      missingUIFields.push(path);
      continue;
    }
    // 检查必填UI字段
    if (!ui.type || !ui.label || !ui.section) {
      missingUIFields.push(path);
    }
    // 检查选择类控件的选项
    if ((ui.type === 'select' || ui.type === 'radio') && 
        (!('options' in ui) || !ui.options || ui.options.length === 0)) {
      logger.warn('config_option_list_empty', '配置项 "{0}" 的选项列表为空', path);
    }
  }
  if (missingUIFields.length > 0) {
    logger.warn('config_missing_ui_fields', '发现缺少UI字段的配置项: {0}', missingUIFields.join(','));
  }
  // 输出总览
  console.log(`✓ 配置验证完成: ${Object.keys(configDefs).length}个配置项, ${sections.size}个部分`);
}
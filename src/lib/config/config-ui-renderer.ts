import { ConfigUI } from "./config-types.js";
import { Logger } from "../logger/logger.js";

/**
 * 配置UI渲染器 - 负责生成和管理配置用户界面
 */
export class ConfigUIRenderer {
  private logger: Logger;
  private metadataCache: Record<string, ConfigUI.UIMetadata> = {};

  constructor() {
    this.logger = new Logger("ConfigUIRenderer");
  }

  /**
   * 渲染完整的配置页面
   */
  public renderConfigUI(
    configMetadata: Record<string, ConfigUI.UIMetadata>,
    currentConfig: any,
    options: ConfigUI.RenderOptions
  ): void {
    this.logger.debug("开始渲染配置UI");
    this.metadataCache = configMetadata;

    const { container } = options;

    // 清空容器
    container.innerHTML = "";

    // 按部分分组并排序 - 修改Map类型声明
    const sectionMap: Map<
      string,
      Array<ConfigUI.UIMetadata & { path: string }>
    > = new Map();

    // 分组和排序元数据
    const sortedPaths = this.sortConfigPaths(
      Object.keys(configMetadata),
      configMetadata
    );

    for (const path of sortedPaths) {
      const metadata = configMetadata[path];
      const section = metadata.section || "其他设置";

      if (!sectionMap.has(section)) {
        sectionMap.set(section, []);
      }

      sectionMap.get(section)!.push({
        ...metadata,
        path, // 添加路径属性，方便后续处理
      });
    }

    // 按部分创建UI
    for (const [sectionName, items] of sectionMap.entries()) {
      this.renderSection(container, sectionName, items, currentConfig, options);
    }

    // 添加按钮部分
    if (options.showSaveButton || options.showResetButton) {
      this.renderButtons(container, options);
    }

    this.logger.debug("配置UI渲染完成");
  }

  /**
   * 更新现有UI元素的值
   */
  public updateUIValues(currentConfig: any): void {
    this.logger.debug("更新UI元素值");

    // 遍历所有带有data-config-path属性的元素
    document.querySelectorAll("[data-config-path]").forEach((element) => {
      const path = element.getAttribute("data-config-path");
      if (!path) return;

      const value = this.getConfigValueByPath(currentConfig, path);
      const metadata = this.metadataCache[path];

      if (value === undefined) return;

      this.updateElementValue(element as HTMLElement, value, metadata);
    });
  }

  /**
   * 收集UI中的所有配置值
   * @template T 配置类型
   * @returns 收集到的配置值
   */
  public collectConfigValues<T>(): Partial<T> {
    this.logger.debug("收集配置值");
    const values = {} as Partial<T>;

    document.querySelectorAll("[data-config-path]").forEach((element) => {
      const path = element.getAttribute("data-config-path");
      if (!path) return;

      const metadata = this.metadataCache[path];
      const value = this.getElementValue(element as HTMLElement, metadata);

      // 使用类型安全的方式设置值
      this.setConfigValueByPath(values, path, value);
    });

    return values;
  }

  /**
   * 渲染单个配置部分
   */
  private renderSection(
    container: HTMLElement,
    title: string,
    items: Array<ConfigUI.UIMetadata & { path: string }>,
    currentConfig: any,
    options: ConfigUI.RenderOptions
  ): void {
    const section = document.createElement("div");
    section.className = "option-section";
    section.innerHTML = `<h2>${title}</h2>`;

    // 渲染每个配置项
    for (const metadata of items) {
      const path = (metadata as any).path;
      const value = this.getConfigValueByPath(currentConfig, path);

      // 检查条件表达式
      if (
        metadata.condition &&
        !this.evaluateCondition(metadata.condition, currentConfig)
      ) {
        continue;
      }

      section.appendChild(
        this.renderConfigItem(path, metadata, value, options)
      );
    }

    container.appendChild(section);
  }

  /**
   * 渲染单个配置项
   */
  private renderConfigItem(
    path: string,
    metadata: ConfigUI.UIMetadata,
    value: any,
    options: ConfigUI.RenderOptions
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "option-row";
    row.setAttribute("data-config-item", path);

    // 添加标签
    const label = document.createElement("div");
    label.className = "option-label";
    label.textContent = metadata.label;
    row.appendChild(label);

    // 添加控件容器
    const control = document.createElement("div");
    control.className = "option-control";

    // 根据类型创建控件
    const input = this.createControl(path, metadata, value);

    // 如果有onChange处理程序，添加事件监听器
    if (options.onChange) {
      input.addEventListener("change", () => {
        const newValue = this.getElementValue(input, metadata);
        options.onChange!(path, newValue);
      });
    }

    control.appendChild(input);

    // 添加描述
    if (metadata.description) {
      const description = document.createElement("div");
      description.className = "option-description";
      description.textContent = metadata.description;
      control.appendChild(description);
    }

    row.appendChild(control);
    return row;
  }

  /**
   * 创建控件
   */
  private createControl(
    path: string,
    metadata: ConfigUI.UIMetadata,
    value: any
  ): HTMLElement {
    switch (metadata.type) {
      case "checkbox":
        return this.createCheckbox(
          path,
          metadata as ConfigUI.CheckboxUIMetadata,
          value
        );
      case "select":
        return this.createSelect(
          path,
          metadata as ConfigUI.SelectUIMetadata,
          value
        );
      case "number":
        return this.createNumberInput(
          path,
          metadata as ConfigUI.NumberUIMetadata,
          value
        );
      case "text":
        return this.createTextInput(
          path,
          metadata as ConfigUI.TextUIMetadata,
          value
        );
      case "color":
        return this.createColorInput(
          path,
          metadata as ConfigUI.ColorUIMetadata,
          value
        );
      case "radio":
        return this.createRadioGroup(
          path,
          metadata as ConfigUI.RadioUIMetadata,
          value
        );
      case "password":
        return this.createPasswordInput(
          path,
          metadata as ConfigUI.PasswordUIMetadata,
          value
        );
      case "group": {
        const groupMeta = metadata as any;
        const container = document.createElement("fieldset");
        container.className = "option-group option-group-card" + (path.split(".").length > 1 ? " option-group-nested" : "");
        if (groupMeta.label) {
          const legend = document.createElement("legend");
          legend.className = "option-group-legend";
          legend.textContent = groupMeta.label;
          container.appendChild(legend);
        }
        if (groupMeta.description) {
          const desc = document.createElement("div");
          desc.className = "option-group-description";
          desc.textContent = groupMeta.description;
          container.appendChild(desc);
        }
        const rowList: HTMLElement[] = [];
        const fieldMetas = Array.isArray(groupMeta.fields) ? groupMeta.fields : [];
        // group 内采用两栏式布局（label+控件），但 fieldset 外不再有 label
        for (let i = 0; i < fieldMetas.length; i++) {
          const field = fieldMetas[i];
          const fieldPath = path ? `${path}.${field.key}` : field.key;
          const fieldValue = value ? value[field.key] : undefined;
          const fieldMeta = { ...field, section: groupMeta.section || "", order: field.order };
          const row = document.createElement("div");
          row.className = "option-row option-row-group-field option-row-group-flex";
          // group 内显示 label+控件
          if (fieldMeta.label) {
            const label = document.createElement("div");
            label.className = "option-label option-label-group";
            label.textContent = fieldMeta.label;
            row.appendChild(label);
          }
          const control = document.createElement("div");
          control.className = "option-control option-control-group";
          const input = this.createControl(fieldPath, fieldMeta, fieldValue);
          control.appendChild(input);
          // 字段自身 description
          if (fieldMeta.description) {
            const description = document.createElement("div");
            description.className = "option-description option-description-group";
            description.textContent = fieldMeta.description;
            control.appendChild(description);
          }
          row.appendChild(control);
          // 条件联动：初始显示/隐藏
          if (fieldMeta.condition) {
            const visible = this.evaluateCondition(fieldMeta.condition, { ...value, ...{ [path]: value } });
            row.style.display = visible ? '' : 'none';
          }
          container.appendChild(row);
          rowList.push(row);
        }
        // 事件联动：只要任一字段变动，重新评估所有字段的显示/隐藏
        container.addEventListener('input', () => {
          // 收集当前 group 内所有字段的值
          const groupInputs = container.querySelectorAll('[data-config-path^="' + path + '."]');
          const newGroupValue: any = {};
          groupInputs.forEach((el: any) => {
            const p = el.getAttribute("data-config-path");
            if (p) {
              const k = p.slice(path.length + 1);
              if (el instanceof HTMLInputElement) {
                if (el.type === 'checkbox') {
                  newGroupValue[k] = el.checked;
                } else if (el.type === 'radio') {
                  if (el.checked) newGroupValue[k] = el.value;
                } else {
                  newGroupValue[k] = el.value;
                }
              } else if (el instanceof HTMLSelectElement) {
                newGroupValue[k] = el.value;
              } else if (el instanceof HTMLTextAreaElement) {
                newGroupValue[k] = el.value;
              }
            }
          });
          rowList.forEach((rowEl, idx) => {
            const meta = fieldMetas[idx];
            if (meta && meta.condition) {
              const visible = this.evaluateCondition(meta.condition, { ...newGroupValue, ...{ [path]: newGroupValue } });
              (rowEl as HTMLElement).style.display = visible ? '' : 'none';
            } else {
              (rowEl as HTMLElement).style.display = '';
            }
          });
        });
        return container;
      }
      case "hidden":
        // 隐藏字段不渲染任何控件
        return document.createElement("span");
      default:
        this.logger.warn(`未知的控件类型: ${(metadata as any).type}`);
        const fallback = document.createElement("div");
        fallback.textContent = `不支持的控件类型: ${(metadata as any).type}`;
        return fallback;
    }
  }

  /**
   * 创建复选框
   */
  private createCheckbox(
    path: string,
    metadata: ConfigUI.CheckboxUIMetadata,
    value: boolean
  ): HTMLElement {
    const container = document.createElement("div");

    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `config-${path.replace(/\./g, "-")}`;
    checkbox.checked = Boolean(value);
    checkbox.setAttribute("data-config-path", path);

    label.appendChild(checkbox);

    if (metadata.checkboxLabel) {
      const span = document.createElement("span");
      span.textContent = ` ${metadata.checkboxLabel}`;
      label.appendChild(span);
    }

    container.appendChild(label);
    return container;
  }

  /**
   * 创建选择框
   */
  private createSelect(
    path: string,
    metadata: ConfigUI.SelectUIMetadata,
    value: string
  ): HTMLSelectElement {
    const select = document.createElement("select");
    select.id = `config-${path.replace(/\./g, "-")}`;
    select.setAttribute("data-config-path", path);

    // 添加选项
    for (const option of metadata.options) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      optionEl.selected = option.value === value;
      select.appendChild(optionEl);
    }

    return select;
  }

  /**
   * 创建数字输入框
   */
  private createNumberInput(
    path: string,
    metadata: ConfigUI.NumberUIMetadata,
    value: number
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.id = `config-${path.replace(/\./g, "-")}`;
    input.setAttribute("data-config-path", path);

    // 应用属性
    if (metadata.min !== undefined) input.min = String(metadata.min);
    if (metadata.max !== undefined) input.max = String(metadata.max);
    if (metadata.step !== undefined) input.step = String(metadata.step);

    // 应用值（考虑转换器）
    const displayValue = metadata.reverter ? metadata.reverter(value) : value;
    input.value = String(displayValue);

    return input;
  }

  /**
   * 创建文本输入框
   */
  private createTextInput(
    path: string,
    metadata: ConfigUI.TextUIMetadata,
    value: string
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.id = `config-${path.replace(/\./g, "-")}`;
    input.setAttribute("data-config-path", path);

    // 应用属性
    if (metadata.placeholder) input.placeholder = metadata.placeholder;
    if (metadata.pattern) input.pattern = metadata.pattern;

    input.value = value || "";

    return input;
  }

  /**
   * 创建颜色选择器
   */
  private createColorInput(
    path: string,
    metadata: ConfigUI.ColorUIMetadata,
    value: string
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "color";
    input.id = `config-${path.replace(/\./g, "-")}`;
    input.setAttribute("data-config-path", path);
    input.value = value || metadata.defaultValue || "#000000";

    return input;
  }

  /**
   * 创建单选按钮组
   */
  private createRadioGroup(
    path: string,
    metadata: ConfigUI.RadioUIMetadata,
    value: string
  ): HTMLElement {
    const container = document.createElement("div");
    container.className = metadata.inline
      ? "radio-group-inline"
      : "radio-group";

    for (const option of metadata.options) {
      const label = document.createElement("label");
      label.className = "radio-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `config-radio-${path.replace(/\./g, "-")}`;
      radio.value = option.value;
      radio.checked = option.value === value;
      radio.setAttribute("data-config-path", path);

      label.appendChild(radio);
      label.appendChild(document.createTextNode(` ${option.label}`));
      container.appendChild(label);
    }

    return container;
  }

  /**
   * 创建密码输入框
   */
  private createPasswordInput(
    path: string,
    metadata: ConfigUI.PasswordUIMetadata,
    value: string
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "password";
    input.id = `config-${path.replace(/\./g, "-")}`;
    input.setAttribute("data-config-path", path);
    if (metadata.placeholder) input.placeholder = metadata.placeholder;
    input.value = value || "";
    return input;
  }

  /**
   * 渲染保存/重置按钮
   */
  private renderButtons(
    container: HTMLElement,
    options: ConfigUI.RenderOptions
  ): void {
    const buttonSection = document.createElement("div");
    buttonSection.className = "option-section action-buttons";

    if (options.showSaveButton) {
      const saveButton = document.createElement("button");
      saveButton.id = "config-save-button";
      saveButton.textContent = "保存设置";
      saveButton.className = "primary-button";
      saveButton.addEventListener("click", async () => {
        if (options.onSave) {
          saveButton.disabled = true;
          saveButton.textContent = "保存中...";

          try {
            await options.onSave();

            saveButton.textContent = "保存成功";
            setTimeout(() => {
              saveButton.disabled = false;
              saveButton.textContent = "保存设置";
            }, 2000);
          } catch (error) {
            saveButton.textContent = "保存失败";
            setTimeout(() => {
              saveButton.disabled = false;
              saveButton.textContent = "保存设置";
            }, 2000);
            this.logger.error("保存配置失败", error);
          }
        }
      });
      buttonSection.appendChild(saveButton);

      // 添加保存成功消息
      const saveMessage = document.createElement("span");
      saveMessage.id = "config-save-message";
      saveMessage.className = "success-message";
      saveMessage.textContent = "设置已保存！";
      saveMessage.style.display = "none";
      buttonSection.appendChild(saveMessage);
    }

    if (options.showResetButton) {
      const resetButton = document.createElement("button");
      resetButton.id = "config-reset-button";
      resetButton.textContent = "恢复默认";
      resetButton.className = "secondary-button";
      resetButton.addEventListener("click", async () => {
        if (confirm("确定要恢复所有设置为默认值吗？此操作无法撤销。")) {
          if (options.onReset) {
            resetButton.disabled = true;
            resetButton.textContent = "重置中...";

            try {
              await options.onReset();

              resetButton.textContent = "重置成功";
              setTimeout(() => {
                resetButton.disabled = false;
                resetButton.textContent = "恢复默认";
              }, 2000);
            } catch (error) {
              resetButton.textContent = "重置失败";
              setTimeout(() => {
                resetButton.disabled = false;
                resetButton.textContent = "恢复默认";
              }, 2000);
              this.logger.error("重置配置失败", error);
            }
          }
        }
      });
      buttonSection.appendChild(resetButton);
    }

    container.appendChild(buttonSection);
  }

  /**
   * 从元素获取值
   */
  private getElementValue(
    element: HTMLElement,
    metadata?: ConfigUI.UIMetadata
  ): any {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") {
        return element.checked;
      } else if (element.type === "radio") {
        const checkedInput = document.querySelector(
          `input[name="${element.name}"]:checked`
        ) as HTMLInputElement;
        return checkedInput ? checkedInput.value : null;
      } else if (element.type === "number") {
        const value = Number(element.value);
        // 应用转换器（如果有）
        return metadata && "converter" in metadata && metadata.converter
          ? metadata.converter(value)
          : value;
      } else {
        return element.value;
      }
    } else if (element instanceof HTMLSelectElement) {
      return element.value;
    }

    return null;
  }

  /**
   * 更新元素值
   */
  private updateElementValue(
    element: HTMLElement,
    value: any,
    metadata?: ConfigUI.UIMetadata
  ): void {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") {
        element.checked = Boolean(value);
      } else if (element.type === "radio") {
        if (element.value === value) {
          element.checked = true;
        }
      } else if (element.type === "number") {
        // 应用反向转换器（如果有）
        const displayValue =
          metadata && "reverter" in metadata && metadata.reverter
            ? metadata.reverter(value)
            : value;
        element.value = String(displayValue);
      } else {
        element.value = value;
      }
    } else if (element instanceof HTMLSelectElement) {
      element.value = value;
    }
  }

  /**
   * 按路径从配置对象获取值
   */
  private getConfigValueByPath(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;

    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }

    return current;
  }

  /**
   * 按路径设置配置对象的值
   */
  private setConfigValueByPath(obj: any, path: string, value: any): void {
    const parts = path.split(".");
    let current = obj;

    // 遍历路径，创建必要的对象结构
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
   * 评估条件表达式
   */
  private evaluateCondition(condition: string, config: any): boolean {
    try {
      // 这里提供一个简单的条件语法，可以扩展为更复杂的表达式
      // 示例: "logging.level === 'debug'" 或 "appearance.theme !== 'light'"
      const parts = condition.match(
        /^(\w+(?:\.\w+)*)\s*([!=<>]+)\s*['"]?([^'"]+)['"]?$/
      );

      if (!parts) return true; // 如果无法解析，默认显示

      const [_, path, operator, expectedValue] = parts;
      const actualValue = this.getConfigValueByPath(config, path);

      switch (operator) {
        case "===":
        case "==":
          return actualValue == expectedValue;
        case "!==":
        case "!=":
          return actualValue != expectedValue;
        case ">":
          return actualValue > expectedValue;
        case ">=":
          return actualValue >= expectedValue;
        case "<":
          return actualValue < expectedValue;
        case "<=":
          return actualValue <= expectedValue;
        default:
          return true;
      }
    } catch (error) {
      this.logger.error("条件评估失败", error);
      return true; // 出错时默认显示
    }
  }

  /**
   * 排序配置路径
   */
  private sortConfigPaths(
    paths: string[],
    metadata: Record<string, ConfigUI.UIMetadata>
  ): string[] {
    return [...paths].sort((a, b) => {
      // 首先按部分排序
      const sectionA = metadata[a].section || "";
      const sectionB = metadata[b].section || "";

      if (sectionA !== sectionB) {
        return sectionA.localeCompare(sectionB);
      }

      // 然后按排序号排序（如果有）
      const orderA = metadata[a].order || 0;
      const orderB = metadata[b].order || 0;

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      // 最后按标签排序
      return (metadata[a].label || "").localeCompare(metadata[b].label || "");
    });
  }
}

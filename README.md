# Chrome 扩展脚手架

这是一个用于快速开发 Chrome 扩展的脚手架项目，基于 TypeScript 和现代化工具链构建。

## 功能特性

- 🚀 **TypeScript 支持** - 完整的类型支持和代码提示
- 📦 **模块化架构** - 松耦合的组件设计，易于扩展和维护
- 💾 **存储系统** - 统一的存储接口，支持多种存储后端
- 🌐 **国际化** - 内置的多语言支持系统
- 📝 **日志系统** - 灵活的日志记录与管理
- 📮 **消息系统** - 简化的通信机制，处理不同上下文间的通信
- ⚙️ **配置系统** - 集中化的配置管理
- 🔄 **浏览器事件系统** - 简化的事件处理机制

## 快速开始

1. 创建新项目

```bash
# 初始化新项目
npx create-chrome-extension my-extension

# 或者使用脚本直接从仓库创建
node scripts/create-project.js
```

2. 开发

```bash
# 安装依赖
npm install

# 开发模式构建
npm run dev

# 生产构建
npm run build
```

3. 加载扩展

- 打开 Chrome 浏览器，导航到 chrome://extensions
- 启用 "开发者模式"
- 点击 "加载已解压的扩展"，选择 `dist` 目录

## 项目架构

```bash
├── src/                      # 源代码目录
│   ├── manifest.json         # 扩展清单
│   ├── background/           # 后台脚本
│   ├── content/              # 内容脚本
│   ├── popup/                # 弹出窗口
│   ├── options/              # 选项页面
│   ├── assets/               # 静态资源
│   ├── _locales/             # 国际化资源
│   └── lib/                  # 共享库
│       ├── config/           # 配置系统
│       ├── storage/          # 存储系统
│       ├── i18n/             # 国际化系统
│       ├── logger/           # 日志系统
│       ├── messaging/        # 消息系统
│       └── browser-events/   # 浏览器事件系统
├── webpack/                  # Webpack 配置
├── dist/                     # 构建输出
└── examples/                 # 示例代码
```

## 核心模块

### 存储系统

提供统一的数据存取接口，支持多种存储后端：

- Chrome 本地存储 (chrome.storage.local)
- Chrome 同步存储 (chrome.storage.sync)
- IndexedDB
- Web Storage (localStorage/sessionStorage)
- 内存存储

```javascript
import { storage } from './lib/storage/index.js';

// 存储数据
await storage.set('key', { value: 'data' });

// 获取数据
const data = await storage.get('key');

// 监听变化
storage.onChange('key', (newValue, oldValue) => {
  console.log(`值从 ${oldValue} 变为 ${newValue}`);
});
```

### 国际化系统

简化多语言支持的实现：

```javascript
import { i18n } from './lib/i18n/i18n.js';

// 获取翻译文本
const message = i18n.getMessage('messageKey');

// 带参数的翻译
const greeting = i18n.getMessage('greeting', ['用户名']);
```

### 日志系统

增强的日志记录功能：

```javascript
import { logger } from './lib/logger/logger.js';

logger.debug('详细信息', { data: 'some data' });
logger.info('普通信息');
logger.warn('警告信息');
logger.error('错误信息', new Error('发生错误'));
```

### 消息系统

简化不同上下文间的通信：

```javascript
import { messenger } from './lib/messaging/messenger.js';

// 在内容脚本中发送消息到后台
const response = await messenger.sendToBackground('action', { data: value });

// 在后台脚本中监听消息
messenger.onMessage('action', async (data, sender) => {
  return { result: 'success', data: processedData };
});
```

### 配置系统

集中化的配置管理：

```javascript
import { config } from './lib/config/index.js';

// 读取配置
const logLevel = config.get('logging.level');

// 更新配置
config.update({
  logging: {
    level: 'debug',
    console: true
  }
});
```

### 贡献

欢迎贡献代码、报告问题或提出新功能建议。请参阅 贡献指南 了解详情。

### 许可证

MIT

<!-- 示例代码如有涉及 key 命名，建议统一为 browsing_visits_、browsing_summary_、highlight_records_、page_snapshots_、record_logs_。 -->
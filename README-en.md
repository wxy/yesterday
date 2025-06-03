# Yesterday/Today - Smart Browsing Insights Chrome Extension

Yesterday/Today is an AI-powered Chrome extension that automatically records your daily browsing history, analyzes your behavior, and generates personalized insight reports. Important content is highlighted in a beautiful card UI. Both sidebar and popup views are supported, with real-time config and AI service status sync.

## Key Features

- **Automatic Visit Logging**: No manual action needed, all daily visits are recorded automatically.
- **AI-Powered Content Analysis**: Local or remote AI services summarize, classify, and extract key points from your browsing.
- **Insight Report Generation**: One-click to generate daily insight reports with structured highlights.
- **Important Content Highlighting**: AI-identified important cards are automatically highlighted in both popup and sidebar.
- **Global Config Sync**: All config changes trigger auto-refresh, keeping frontend and backend in sync.
- **AI Service Status Warning**: When local AI is unavailable, both popup/sidebar show clear warnings and the extension icon changes.
- **Minimal & Beautiful UI**: Card-based info stream, unified and extensible styles, with highlight and structured display.
- **Privacy Friendly**: All data is stored locally; AI analysis can use local or custom services.

## Quick Start

1. **Install dependencies**

```bash
npm install
```

2. **Development/Build**

```bash
# Development mode
npm run dev
# Production build
npm run build
```

3. **Load the extension**

- Open Chrome and go to `chrome://extensions`
- Enable "Developer mode"
- Click "Load unpacked" and select the `dist` directory

4. **Usage**

- Click the extension icon for today's highlights and AI insights in the popup
- Open the sidebar (right-click the icon or use a shortcut) to browse all visits and insight reports for yesterday/today
- Use the options page to configure AI service, analysis strategy, etc.

## Directory Structure

```bash
src/
  background/      # Background scripts (AI check, icon, messaging)
  popup/           # Popup page
  sidebar/         # Sidebar page
  lib/             # Shared libraries (config, messaging, AI, storage, etc.)
  assets/          # Icons and styles
  _locales/        # i18n resources
```

## Advanced Features

- **Pluggable AI Services**: Supports local Ollama, Chrome-AI, and more, with auto-detection
- **Messaging System**: Efficient communication between background, popup, and sidebar, with auto-refresh and status sync
- **Config System**: Centralized management, supports onConfigChanged event for frontend auto-refresh
- **Unified Data Structure**: All visits and analysis results are merged into a single table for easy maintenance
- **Error Handling & Logging**: Key flows have error capture and detailed logs for troubleshooting

## FAQ

- **AI analysis unavailable?**
  - Check if your local AI service is running, or switch to a remote service in the options page.
  - When the icon turns warning color, popup/sidebar will show detailed unavailability info.
- **Data privacy?**
  - All visit and analysis data is stored locally by default, never uploaded to the cloud.
- **How to contribute?**
  - Please submit issues or PRs on GitHub.

## Development & Testing

- See the directory structure above; VS Code is recommended.
- Supports hot reload, TypeScript type hints, and modular development.
- For detailed docs and API reference, see the `docs/` directory.

## License

MIT


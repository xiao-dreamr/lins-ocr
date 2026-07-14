# Obsidian Plugin Development Guide for LLMs

This document is a comprehensive guide for Large Language Models (LLMs) on how to generate high-quality, maintainable, and compliant Obsidian plugins.

## Core Principles

1.  **Safety & Security**:
    *   **NO** arbitrary network calls without user consent.
    *   **NO** remote code execution.
    *   **NO** accessing files outside the vault.
    *   **ALWAYS** use `requestUrl` (from `obsidian` module) for HTTP requests, not `fetch`.

2.  **Performance**:
    *   Minimize work in `onload`.
    *   Debounce file system listeners.
    *   Avoid reading the entire vault.

3.  **Modularity**:
    *   Split code into small, focused files (Single Responsibility Principle).
    *   Use a `src/` directory structure.
    *   `src/main.ts`: Entry point, lifecycle management (onload/onunload), registering commands/settings.
    *   `src/settings.ts`: Settings interface and Tab.
    *   `src/commands/`: Individual command implementations.
    *   `src/ui/`: Modals, Views, and other UI components.

## TypeScript & API Usage

*   **Strict Typing**: Always use TypeScript with `strict: true`. Avoid `any`.
*   **Obsidian API**: Import types and classes from `obsidian`.
    *   `Plugin`, `App`, `Editor`, `MarkdownView`, `Modal`, `Notice`, `Setting`, `PluginSettingTab`.
*   **Asynchronous Operations**: Use `async/await` for all file I/O and network operations.

## File Structure Standard

Generate plugins using this directory structure:

```
src/
├── main.ts           # Plugin entry point
├── settings.ts       # Settings definition & UI
├── types.ts          # Shared interfaces
├── utils/            # Helper functions
└── commands/         # Separate file for each command logic (optional but recommended for complex commands)
    ├── insert-date.ts
    └── format-table.ts
styles.css            # CSS styles
manifest.json         # Plugin metadata
esbuild.config.mjs    # Build configuration
```

## Implementation Patterns

### 1. `src/main.ts` (Entry Point)

The `main.ts` should be minimal. It orchestrates the plugin's components.

```typescript
import { Plugin } from 'obsidian';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab } from './settings';
import { insertDateCommand } from './commands/insert-date';

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;

    async onload() {
        await this.loadSettings();

        // Register Commands
        this.addCommand({
            id: 'insert-date',
            name: 'Insert Date',
            editorCallback: (editor) => insertDateCommand(editor, this.settings)
        });

        // Add Settings Tab
        this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
```

### 2. Network Requests (`requestUrl`)

**CRITICAL**: Do NOT use `fetch`. Use `requestUrl` to avoid CORS issues and adhere to Obsidian's API.

```typescript
import { requestUrl, RequestUrlParam } from 'obsidian';

async function fetchData(url: string) {
    try {
        const response = await requestUrl({
            url: url,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.status !== 200) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }

        return response.json;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}
```

### 3. Modifing Content (Editor Transactions)

Use the `Editor` interface for text manipulation.

```typescript
import { Editor } from 'obsidian';

export function insertText(editor: Editor, text: string) {
    const cursor = editor.getCursor();
    editor.replaceRange(text, cursor);
    // Move cursor to end of inserted text
    editor.setCursor({
        line: cursor.line,
        ch: cursor.ch + text.length
    });
}
```

### 4. Settings (`src/settings.ts`)

```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';

export interface MyPluginSettings {
    dateFormat: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
    dateFormat: 'YYYY-MM-DD'
};

export class SampleSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Date Format')
            .setDesc('Moment.js format string')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value;
                    await this.plugin.saveSettings();
                }));
    }
}
```

## Hot Reloading

This project is set up for hot reloading. A `.hotreload` file is present in the root. Ensure you have the "Hot Reload" plugin installed in Obsidian for this to work during development.

## Build System

*   **esbuild** is the bundler.
*   **src/main.ts** is the entry point.
*   **main.js** is the output (bundled) file.
*   Do NOT modify `main.js` manually. 

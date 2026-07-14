import { App, PluginSettingTab, Setting } from 'obsidian';
import type LinsOCRPlugin from './main';

export interface LinsOCRSettings {
    // WSL 配置
    wslDistro: string;
    condaEnvPath: string;
    pipelineName: string;
    servicePort: number;

    // 服务端点
    healthCheckUrl: string;
    layoutParsingUrl: string;
    restructurePagesUrl: string;

    // 输出配置
    outputFolder: string;
    attachmentsFolder: string;

    // 行为配置
    idleTimeout: number;
    maxImageDimension: number;
}

export const DEFAULT_SETTINGS: LinsOCRSettings = {
    wslDistro: 'Arch',
    condaEnvPath: '/home/lin/miniconda3/envs/paddle',
    pipelineName: 'PaddleOCR-VL',
    servicePort: 8080,
    healthCheckUrl: 'http://127.0.0.1:8080/health',
    layoutParsingUrl: 'http://127.0.0.1:8080/layout-parsing',
    restructurePagesUrl: 'http://127.0.0.1:8080/restructure-pages',
    outputFolder: '',
    attachmentsFolder: 'attachments',
    idleTimeout: 120,
    maxImageDimension: 1280,
};

/**
 * 根据端口号生成各端点 URL
 */
function buildUrls(port: number): {
    healthCheckUrl: string;
    layoutParsingUrl: string;
    restructurePagesUrl: string;
} {
    const base = `http://127.0.0.1:${port}`;
    return {
        healthCheckUrl: `${base}/health`,
        layoutParsingUrl: `${base}/layout-parsing`,
        restructurePagesUrl: `${base}/restructure-pages`,
    };
}

export class LinsOCRSettingTab extends PluginSettingTab {
    plugin: LinsOCRPlugin;

    constructor(app: App, plugin: LinsOCRPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ========== WSL 配置 ==========
        containerEl.createEl('h2', { text: 'WSL 配置' });

        new Setting(containerEl)
            .setName('WSL 发行版名称')
            .setDesc('WSL 中安装 PaddleOCR-VL 的 Linux 发行版名称')
            .addText(text => text
                .setPlaceholder('Arch')
                .setValue(this.plugin.settings.wslDistro)
                .onChange(async (value) => {
                    this.plugin.settings.wslDistro = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Conda 环境路径')
            .setDesc('conda 环境的绝对路径，例如 /home/lin/miniconda3/envs/paddle')
            .addText(text => text
                .setPlaceholder('/home/lin/miniconda3/envs/paddle')
                .setValue(this.plugin.settings.condaEnvPath)
                .onChange(async (value) => {
                    this.plugin.settings.condaEnvPath = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('管线名称')
            .setDesc('PaddleOCR-VL 管线名称，可选: PaddleOCR-VL, PaddleOCR-VL-1.5, PaddleOCR-VL-1.6 等')
            .addText(text => text
                .setPlaceholder('PaddleOCR-VL')
                .setValue(this.plugin.settings.pipelineName)
                .onChange(async (value) => {
                    this.plugin.settings.pipelineName = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('服务端口')
            .setDesc('PaddleOCR-VL HTTP 服务的监听端口')
            .addText(text => text
                .setPlaceholder('8080')
                .setValue(String(this.plugin.settings.servicePort))
                .onChange(async (value) => {
                    const port = parseInt(value, 10);
                    if (!isNaN(port) && port > 0 && port <= 65535) {
                        this.plugin.settings.servicePort = port;
                        // 同步更新所有 URL
                        const urls = buildUrls(port);
                        this.plugin.settings.healthCheckUrl = urls.healthCheckUrl;
                        this.plugin.settings.layoutParsingUrl = urls.layoutParsingUrl;
                        this.plugin.settings.restructurePagesUrl = urls.restructurePagesUrl;
                        await this.plugin.saveSettings();
                        // 刷新设置页以显示更新后的 URL
                        this.display();
                    }
                }));

        // ========== 服务端点 ==========
        containerEl.createEl('h2', { text: '服务端点' });

        new Setting(containerEl)
            .setName('健康检查地址')
            .setDesc('GET 请求此地址以检测服务是否存活')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:8080/health')
                .setValue(this.plugin.settings.healthCheckUrl)
                .onChange(async (value) => {
                    this.plugin.settings.healthCheckUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('版面解析地址')
            .setDesc('POST /layout-parsing 端点地址')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:8080/layout-parsing')
                .setValue(this.plugin.settings.layoutParsingUrl)
                .onChange(async (value) => {
                    this.plugin.settings.layoutParsingUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('页面重组地址')
            .setDesc('POST /restructure-pages 端点地址')
            .addText(text => text
                .setPlaceholder('http://127.0.0.1:8080/restructure-pages')
                .setValue(this.plugin.settings.restructurePagesUrl)
                .onChange(async (value) => {
                    this.plugin.settings.restructurePagesUrl = value;
                    await this.plugin.saveSettings();
                }));

        // ========== 输出与行为配置 ==========
        containerEl.createEl('h2', { text: '输出与行为' });

        new Setting(containerEl)
            .setName('输出目录')
            .setDesc('OCR 结果 .md 文件的输出目录，留空为仓库根目录')
            .addText(text => text
                .setPlaceholder('例如 OCR_Results')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.outputFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('附件目录')
            .setDesc('OCR 解析出的图片保存目录')
            .addText(text => text
                .setPlaceholder('attachments')
                .setValue(this.plugin.settings.attachmentsFolder)
                .onChange(async (value) => {
                    this.plugin.settings.attachmentsFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('空闲超时（秒）')
            .setDesc('OCR 完成后空闲多少秒自动关闭 WSL 服务以释放显存')
            .addText(text => text
                .setPlaceholder('120')
                .setValue(String(this.plugin.settings.idleTimeout))
                .onChange(async (value) => {
                    const timeout = parseInt(value, 10);
                    if (!isNaN(timeout) && timeout > 0) {
                        this.plugin.settings.idleTimeout = timeout;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('图片长边最大像素')
            .setDesc('图片长边超过此值时自动等比缩放（避免大图导致推理卡顿）')
            .addText(text => text
                .setPlaceholder('1280')
                .setValue(String(this.plugin.settings.maxImageDimension))
                .onChange(async (value) => {
                    const dim = parseInt(value, 10);
                    if (!isNaN(dim) && dim > 0) {
                        this.plugin.settings.maxImageDimension = dim;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}

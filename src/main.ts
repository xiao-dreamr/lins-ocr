import { Notice, Plugin } from 'obsidian';
import {
    LinsOCRSettings,
    DEFAULT_SETTINGS,
    LinsOCRSettingTab,
} from './settings';
import { WslServiceManager } from './services/wsl-service';
import { OcrApiService } from './services/ocr-api';
import { OcrOrchestrator } from './services/ocr-orchestrator';
import { ocrPictureCommand } from './commands/ocr-picture';
import { ocrPdfFileCommand } from './commands/ocr-pdffile';

export default class LinsOCRPlugin extends Plugin {
    settings: LinsOCRSettings;
    wslService!: WslServiceManager;
    ocrApi!: OcrApiService;
    ocrOrchestrator!: OcrOrchestrator;

    async onload() {
        await this.loadSettings();

        // 初始化服务层
        this.wslService = new WslServiceManager(this.settings);
        this.ocrApi = new OcrApiService(this.settings);
        this.ocrOrchestrator = new OcrOrchestrator(
            this.app.vault,
            this.settings,
            this.wslService,
            this.ocrApi
        );

        // 注册设置标签页
        this.addSettingTab(new LinsOCRSettingTab(this.app, this));

        // 使用 callback（而非 editorCallback），
        // 使命令在查看图片/PDF 等非 Markdown 视图时也可用
        this.addCommand({
            id: 'ocr-picture',
            name: 'OCR picture',
            callback: () => ocrPictureCommand(this),
        });

        this.addCommand({
            id: 'ocr-pdffile',
            name: 'OCR PDF file',
            callback: () => ocrPdfFileCommand(this),
        });

        this.addCommand({
            id: 'stop-ocr-service',
            name: 'Stop OCR service',
            callback: () => {
                this.wslService.shutdown().then(() => {
                    new Notice('OCR 服务已关闭，显存已释放');
                }).catch((err) => {
                    console.error('[LinsOCR] Shutdown error:', err);
                    new Notice('OCR 服务关闭失败，请查看控制台');
                });
            },
        });

        console.log('[LinsOCR] Plugin loaded');
    }

    onunload() {
        // fire-and-forget: 尝试关闭 WSL 服务以释放 GPU 显存
        this.wslService?.shutdown().catch(console.error);
        console.log('[LinsOCR] Plugin unloaded');
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // 同步设置到各服务
        this.wslService?.updateSettings(this.settings);
        this.ocrApi?.updateSettings(this.settings);
    }
}

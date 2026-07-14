import { Editor, MarkdownView, Plugin } from 'obsidian';
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

        // 注册命令
        this.addCommand({
            id: 'ocr-picture',
            name: 'OCR picture',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                ocrPictureCommand(this, editor, view);
            },
        });

        this.addCommand({
            id: 'ocr-pdffile',
            name: 'OCR PDF file',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                ocrPdfFileCommand(this, editor, view);
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

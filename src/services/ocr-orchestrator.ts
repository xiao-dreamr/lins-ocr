import { FileSystemAdapter, Notice, TFile, Vault } from 'obsidian';
import type { LinsOCRSettings } from '../settings';
import { FileType } from '../types';
import { WslServiceManager } from './wsl-service';
import { OcrApiService } from './ocr-api';
import { ImageUtils } from '../utils/image-utils';
import { FileUtils } from '../utils/file-utils';

/**
 * 修整 PaddleOCR-VL 输出中的行内数学公式空格
 * "$ 1+1=2 $" → "$1+1=2$"
 * 不影响 $$...$$（块级公式）和 $100（货币）
 */
function fixInlineMathSpaces(text: string): string {
    // 匹配: 单个 $ (前面不是 $)，一个或多个空格，内容，一个或多个空格，单个 $ (后面不是 $)
    return text.replace(
        /(?<!\$)\$[ ]+([^$\n]+?)[ ]+\$(?!\$)/g,
        (_full: string, content: string) => `$${content.trim()}$`
    );
}

/**
 * OCR 流程编排器
 * 协调 WSL 服务管理、API 调用、文件处理，完成完整的 OCR 工作流。
 */
export class OcrOrchestrator {
    private vault: Vault;
    private settings: LinsOCRSettings;
    private wslService: WslServiceManager;
    private ocrApi: OcrApiService;

    constructor(
        vault: Vault,
        settings: LinsOCRSettings,
        wslService: WslServiceManager,
        ocrApi: OcrApiService
    ) {
        this.vault = vault;
        this.settings = settings;
        this.wslService = wslService;
        this.ocrApi = ocrApi;
    }

    /**
     * 处理单个文件（图片或 PDF）的完整 OCR 流程
     */
    async processFile(file: TFile, fileType: FileType): Promise<void> {
        let notice = new Notice('正在启动 OCR 服务...', 0);

        try {
            // 1. 取消任何待执行的空闲关闭
            this.wslService.cancelShutdown();

            // 2. 确保服务运行
            notice.setMessage('正在检查/启动 OCR 服务...');
            const running = await this.wslService.ensureServiceRunning();
            if (!running) {
                notice.hide();
                new Notice('❌ 无法启动 PaddleOCR-VL 服务（超时 120s）。请在 WSL 中运行 cat /tmp/linsocr-service.log 查看错误详情。');
                return;
            }

            // 3. 读取文件
            notice.setMessage('正在读取文件...');
            let base64Data = await FileUtils.readFileAsBase64(this.vault, file);

            // 4. 图片缩放（仅对图片类型）
            if (fileType === FileType.IMAGE) {
                notice.setMessage('正在预处理图片...');
                base64Data = await ImageUtils.resizeImage(
                    base64Data,
                    this.settings.maxImageDimension
                );
            }

            // 5. 版面解析
            notice.setMessage('正在进行版面解析（layout-parsing）...');
            const layoutResults = await this.ocrApi.layoutParsing(base64Data, fileType);

            if (!layoutResults || layoutResults.length === 0) {
                notice.hide();
                new Notice('❌ 版面解析返回空结果。');
                this.wslService.scheduleShutdown();
                return;
            }

            // 6. 页面重组
            notice.setMessage('正在重组页面...');
            const restructuredResults = await this.ocrApi.restructurePages(
                layoutResults,
                fileType
            );

            // 7. 从原始结果中收集所有图片（restructure 可能不返回 images）
            notice.setMessage('正在保存结果...');
            const allImages = new Map<string, string>(); // imageId → base64
            for (const result of layoutResults) {
                const images = result.markdown?.images ?? {};
                for (const [id, data] of Object.entries(images)) {
                    allImages.set(id, data as string);
                }
            }
            console.log('[LinsOCR] Collected', allImages.size, 'images from layout results');

            const pageMarkdowns: string[] = [];

            for (let i = 0; i < restructuredResults.length; i++) {
                const result = restructuredResults[i];
                const markdown = result.markdown;
                if (!markdown) continue;

                let pageText = markdown.text ?? '';

                // 处理图片：保存到仓库，替换引用
                for (const [imageId, imageBase64] of allImages.entries()) {
                    try {
                        // 取 basename（imageId 可能带目录前缀如 imgs/xxx.jpg）
                        const baseName = imageId.split('/').pop() ?? imageId;
                        const safeFilename = `${file.basename}_p${i}_${baseName}`;
                        const imagePath = this.settings.attachmentsFolder
                            ? `${this.settings.attachmentsFolder}/${safeFilename}`
                            : safeFilename;

                        // 确保附件文件夹存在
                        await FileUtils.ensureFolder(
                            this.vault,
                            this.settings.attachmentsFolder
                        );

                        // 保存图片
                        await FileUtils.saveBase64Image(
                            this.vault,
                            imagePath,
                            imageBase64
                        );

                        // 替换文本中的图片引用（三种格式都要覆盖）
                        const escapedId = imageId.replace(
                            /[.*+?^${}()|[\]\\]/g,
                            '\\$&'
                        );

                        // 1) Markdown 图片语法：![alt](*imageId)
                        pageText = pageText.replace(
                            new RegExp(
                                `!\\[([^\\]]*)\\]\\([^)]*${escapedId}\\)`,
                                'g'
                            ),
                            `![$1](${imagePath})`
                        );

                        // 2) HTML img 标签：<img ... src="*imageId" ...>
                        pageText = pageText.replace(
                            new RegExp(
                                `(<img[^>]*\\bsrc=")[^"]*${escapedId}(")`,
                                'g'
                            ),
                            `$1${imagePath}$2`
                        );

                        // 3) 裸引用：残留的 imageId（含路径前缀如 imgs/）
                        pageText = pageText.replace(
                            new RegExp(`[^")\\s]*${escapedId}`, 'g'),
                            imagePath
                        );
                    } catch (imgErr) {
                        console.warn(
                            `[LinsOCR] Failed to save image ${imageId}:`,
                            imgErr
                        );
                    }
                }

                // 后处理：修正行内数学公式中的多余空格
                pageText = fixInlineMathSpaces(pageText);
                pageMarkdowns.push(pageText);
            }

            // 8. WebP 压缩（如果已配置）
            const q = this.settings.webpQuality;
            const pyScript = this.settings.pythonScriptPath;
            console.log(`[LinsOCR] WebP check: quality=${q}, script='${pyScript}', images=${allImages.size}`);
            if (q > 0 && pyScript && allImages.size > 0) {
                notice.setMessage('正在压缩图片为 WebP...');
                try {
                    // 获取仓库在 Windows 上的绝对路径并转为 WSL 路径
                    const adapter = this.vault.adapter;
                    const fsAdapter = adapter instanceof FileSystemAdapter ? adapter : null;
                    if (!fsAdapter) {
                        console.warn('[LinsOCR] vault.adapter is not FileSystemAdapter, skipping webp');
                    } else {
                        const vaultBasePath = fsAdapter.getBasePath();
                        const wslBase = vaultBasePath
                            .replace(/^([A-Z]):/, (_: string, d: string) =>
                                `/mnt/${d.toLowerCase()}`
                            )
                            .replace(/\\/g, '/');
                        const attachWslPath = this.settings.attachmentsFolder
                            ? `${wslBase}/${this.settings.attachmentsFolder}`
                            : wslBase;

                        const cmd = `python3 '${pyScript}' '${attachWslPath}' -q ${q}`;
                        console.log('[LinsOCR] Running webp compression:', cmd);
                        const out = await this.wslService.execWsl(cmd);
                        console.log('[LinsOCR] WebP compression output:', out);

                        // 替换 markdown 中的图片扩展名为 .webp
                        for (let i = 0; i < pageMarkdowns.length; i++) {
                            pageMarkdowns[i] = pageMarkdowns[i].replace(
                                /\.(jpg|jpeg|png|bmp|tiff|tif)(\b|["')}\s>])/gi,
                                '.webp$2'
                            );
                        }

                        // 清理 *-origin.* 备份文件
                        if (this.settings.cleanupOriginBackups) {
                            const rmCmd = `rm -f '${attachWslPath}'/*-origin.*`;
                            console.log('[LinsOCR] Cleaning up origin backups:', rmCmd);
                            await this.wslService.execWsl(rmCmd);
                        }
                    }
                } catch (err) {
                    console.warn('[LinsOCR] WebP compression failed:', err);
                }
            }

            if (pageMarkdowns.length === 0) {
                notice.hide();
                new Notice('❌ 未能从识别结果中提取到 Markdown 内容。');
                this.wslService.scheduleShutdown();
                return;
            }

            // 合并多页内容
            const combinedMarkdown = pageMarkdowns.join('\n\n---\n\n');

            // 8. 创建输出文件
            const outputPath = this.settings.outputFolder
                ? `${this.settings.outputFolder}/${file.basename}.md`
                : `${file.basename}.md`;

            await FileUtils.ensureFolder(
                this.vault,
                this.settings.outputFolder
            );
            const created = await FileUtils.createMarkdownFile(
                this.vault,
                outputPath,
                combinedMarkdown
            );

            // 9. 调度空闲关闭
            this.wslService.scheduleShutdown();

            // 10. 完成
            notice.hide();
            new Notice(`✅ OCR 完成！已保存到 ${created.path}`);
        } catch (error) {
            notice.hide();
            const message =
                error instanceof Error ? error.message : String(error);
            console.error('[LinsOCR] OCR process failed:', message);
            new Notice(`❌ OCR 失败: ${message}`);

            // 仍然调度关闭，防止服务因错误一直运行
            this.wslService.scheduleShutdown();
        }
    }
}

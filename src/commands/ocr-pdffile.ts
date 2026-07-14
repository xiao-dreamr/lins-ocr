import { MarkdownView } from 'obsidian';
import type LinsOCRPlugin from '../main';
import { FileType, SUPPORTED_PDF_EXTENSIONS } from '../types';
import { VaultFilePickerModal } from '../ui/file-picker-modal';
import { findEmbeddedFileAtCursor } from './helpers';

/**
 * OCR PDF 命令
 * 优先级：
 * 1. 当前活动文件本身是 PDF → 直接 OCR
 * 2. 光标处有嵌入 PDF → OCR 嵌入的文件
 * 3. 弹出文件选择器
 */
export function ocrPdfFileCommand(plugin: LinsOCRPlugin): void {
    const activeFile = plugin.app.workspace.getActiveFile();

    // 1. 当前打开的就是 PDF 文件
    if (activeFile && SUPPORTED_PDF_EXTENSIONS.includes(activeFile.extension.toLowerCase())) {
        plugin.ocrOrchestrator.processFile(activeFile, FileType.PDF);
        return;
    }

    // 2. 在 Markdown 编辑器中查找光标处的嵌入 PDF
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView && mdView.editor) {
        const embedded = findEmbeddedFileAtCursor(
            mdView.editor,
            mdView,
            plugin.app,
            SUPPORTED_PDF_EXTENSIONS
        );
        if (embedded) {
            plugin.ocrOrchestrator.processFile(embedded, FileType.PDF);
            return;
        }
    }

    // 3. 回退：弹出文件选择器
    new VaultFilePickerModal(
        plugin.app,
        SUPPORTED_PDF_EXTENSIONS,
        (file) => {
            plugin.ocrOrchestrator.processFile(file, FileType.PDF);
        }
    ).open();
}

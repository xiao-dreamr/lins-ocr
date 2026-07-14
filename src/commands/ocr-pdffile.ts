import { Editor, MarkdownView } from 'obsidian';
import type LinsOCRPlugin from '../main';
import { FileType, SUPPORTED_PDF_EXTENSIONS } from '../types';
import { VaultFilePickerModal } from '../ui/file-picker-modal';
import { findEmbeddedFileAtCursor } from './helpers';

/**
 * OCR PDF 命令
 * 1. 尝试从光标位置找到嵌入的 PDF
 * 2. 找不到则弹出文件选择器
 */
export function ocrPdfFileCommand(
    plugin: LinsOCRPlugin,
    editor: Editor,
    view: MarkdownView
): void {
    const embedded = findEmbeddedFileAtCursor(
        editor,
        view,
        plugin.app,
        SUPPORTED_PDF_EXTENSIONS
    );

    if (embedded) {
        plugin.ocrOrchestrator.processFile(embedded, FileType.PDF);
        return;
    }

    // 弹出文件选择器
    new VaultFilePickerModal(
        plugin.app,
        SUPPORTED_PDF_EXTENSIONS,
        (file) => {
            plugin.ocrOrchestrator.processFile(file, FileType.PDF);
        }
    ).open();
}

import { MarkdownView } from 'obsidian';
import type LinsOCRPlugin from '../main';
import { FileType, SUPPORTED_IMAGE_EXTENSIONS } from '../types';
import { VaultFilePickerModal } from '../ui/file-picker-modal';
import { findEmbeddedFileAtCursor } from './helpers';

/**
 * OCR 图片命令
 * 优先级：
 * 1. 当前活动文件本身是支持的图片 → 直接 OCR
 * 2. 光标处有嵌入图片 → OCR 嵌入的文件
 * 3. 弹出文件选择器
 */
export function ocrPictureCommand(plugin: LinsOCRPlugin): void {
    const activeFile = plugin.app.workspace.getActiveFile();

    // 1. 当前打开的就是图片文件
    if (activeFile && SUPPORTED_IMAGE_EXTENSIONS.includes(activeFile.extension.toLowerCase())) {
        plugin.ocrOrchestrator.processFile(activeFile, FileType.IMAGE);
        return;
    }

    // 2. 在 Markdown 编辑器中查找光标处的嵌入图片
    const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView && mdView.editor) {
        const embedded = findEmbeddedFileAtCursor(
            mdView.editor,
            mdView,
            plugin.app,
            SUPPORTED_IMAGE_EXTENSIONS
        );
        if (embedded) {
            plugin.ocrOrchestrator.processFile(embedded, FileType.IMAGE);
            return;
        }
    }

    // 3. 回退：弹出文件选择器
    new VaultFilePickerModal(
        plugin.app,
        SUPPORTED_IMAGE_EXTENSIONS,
        (file) => {
            plugin.ocrOrchestrator.processFile(file, FileType.IMAGE);
        }
    ).open();
}

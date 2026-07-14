import { Editor, MarkdownView } from 'obsidian';
import type LinsOCRPlugin from '../main';
import { FileType, SUPPORTED_IMAGE_EXTENSIONS } from '../types';
import { VaultFilePickerModal } from '../ui/file-picker-modal';
import { findEmbeddedFileAtCursor } from './helpers';

/**
 * OCR 图片命令
 * 1. 尝试从光标位置找到嵌入的图片
 * 2. 找不到则弹出文件选择器
 */
export function ocrPictureCommand(
    plugin: LinsOCRPlugin,
    editor: Editor,
    view: MarkdownView
): void {
    const embedded = findEmbeddedFileAtCursor(
        editor,
        view,
        plugin.app,
        SUPPORTED_IMAGE_EXTENSIONS
    );

    if (embedded) {
        plugin.ocrOrchestrator.processFile(embedded, FileType.IMAGE);
        return;
    }

    // 弹出文件选择器
    new VaultFilePickerModal(
        plugin.app,
        SUPPORTED_IMAGE_EXTENSIONS,
        (file) => {
            plugin.ocrOrchestrator.processFile(file, FileType.IMAGE);
        }
    ).open();
}

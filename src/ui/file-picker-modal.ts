import { App, FuzzySuggestModal, TFile } from 'obsidian';

/**
 * 仓库文件选择器
 * 用户在光标处没有嵌入文件时，弹出此模糊搜索窗口手动选择文件。
 */
export class VaultFilePickerModal extends FuzzySuggestModal<TFile> {
    private extensions: string[];
    private onSelect: (file: TFile) => void;

    constructor(
        app: App,
        extensions: string[],
        onSelect: (file: TFile) => void
    ) {
        super(app);
        this.extensions = extensions;
        this.onSelect = onSelect;
        this.setPlaceholder('搜索图片或 PDF 文件...');
    }

    getItems(): TFile[] {
        return this.app.vault.getFiles().filter(f =>
            this.extensions.includes(f.extension.toLowerCase())
        );
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(item);
    }
}

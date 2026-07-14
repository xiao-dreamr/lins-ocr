import { App, Editor, MarkdownView, TFile } from 'obsidian';

/**
 * 从光标所在行查找嵌入的文件（![[filename.ext]] 语法）
 * @returns 解析到的 TFile，或 null
 */
export function findEmbeddedFileAtCursor(
    editor: Editor,
    view: MarkdownView,
    app: App,
    extensions: string[]
): TFile | null {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);

    // 匹配所有 ![[...]] embed
    const embedRegex = /!\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;

    while ((match = embedRegex.exec(line)) !== null) {
        const filename = match[1].trim();
        const dotIdx = filename.lastIndexOf('.');
        if (dotIdx === -1) continue;

        const ext = filename.substring(dotIdx + 1).toLowerCase();
        if (!extensions.includes(ext)) continue;

        // 通过 metadata cache 解析链接
        const sourcePath = view.file?.path ?? '';
        const dest = app.metadataCache.getFirstLinkpathDest(filename, sourcePath);
        if (dest) {
            return dest;
        }
    }

    return null;
}

import { Vault, TFile } from 'obsidian';

/**
 * 文件工具类
 * 封装 Obsidian Vault API 的常用文件操作。
 */
export class FileUtils {
    /**
     * 读取文件内容为 base64 data URI
     */
    static async readFileAsBase64(vault: Vault, file: TFile): Promise<string> {
        const buffer = await vault.readBinary(file);
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const mime = FileUtils.getMimeType(file.extension);
        return `data:${mime};base64,${base64}`;
    }

    /**
     * 递归确保文件夹存在
     */
    static async ensureFolder(vault: Vault, folderPath: string): Promise<void> {
        if (!folderPath) return;

        // 去除首尾斜杠并分割
        const normalized = folderPath.replace(/^\/+|\/+$/g, '');
        const segments = normalized.split('/');

        let currentPath = '';
        for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = vault.getAbstractFileByPath(currentPath);
            if (!existing) {
                await vault.createFolder(currentPath);
            }
        }
    }

    /**
     * 将 base64 数据保存为二进制文件
     * @param vault — Obsidian Vault 实例
     * @param filePath — 仓库内绝对路径
     * @param base64Data — base64 字符串或 data URI
     */
    static async saveBase64Image(
        vault: Vault,
        filePath: string,
        base64Data: string
    ): Promise<TFile> {
        // 剥离 data URI 前缀
        let raw = base64Data;
        const idx = base64Data.indexOf(',');
        if (idx !== -1) {
            raw = base64Data.substring(idx + 1);
        }

        const binary = atob(raw);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return vault.createBinary(filePath, bytes.buffer);
    }

    /**
     * 创建 Markdown 文件，自动处理同名冲突
     */
    static async createMarkdownFile(
        vault: Vault,
        filePath: string,
        content: string
    ): Promise<TFile> {
        let finalPath = filePath;

        // 检查同路径冲突并递增编号
        let counter = 1;
        while (vault.getAbstractFileByPath(finalPath)) {
            // 在 .md 前插入编号
            const base = filePath.replace(/\.md$/, '');
            finalPath = `${base} (${counter}).md`;
            counter++;
        }

        return vault.create(finalPath, content);
    }

    /**
     * 扩展名 → MIME type 映射
     */
    static getMimeType(extension: string): string {
        const ext = extension.toLowerCase();
        const map: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            bmp: 'image/bmp',
            webp: 'image/webp',
            tiff: 'image/tiff',
            tif: 'image/tiff',
            svg: 'image/svg+xml',
            pdf: 'application/pdf',
        };
        return map[ext] ?? 'application/octet-stream';
    }
}

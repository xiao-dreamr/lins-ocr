import { Vault, TFile, TFolder } from 'obsidian';

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
        // 分块转换，避免逐字节字符串拼接的 O(n²)（大 PDF 时性能显著提升）
        const CHUNK_SIZE = 0x8000; // 32768，低于 V8 参数展开上限
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
        }
        const binary = chunks.join('');
        const base64 = btoa(binary);
        const mime = FileUtils.getMimeType(file.extension);
        return `data:${mime};base64,${base64}`;
    }

    /**
     * 递归确保文件夹存在
     */
    static async ensureFolder(vault: Vault, folderPath: string): Promise<void> {
        if (!folderPath) return;

        // 去除首尾斜杠、过滤空段（处理 a//b 双斜杠），再分割
        const normalized = folderPath.replace(/^\/+|\/+$/g, '');
        const segments = normalized.split('/').filter(seg => seg.length > 0);

        let currentPath = '';
        for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = vault.getAbstractFileByPath(currentPath);
            if (existing instanceof TFolder) {
                continue;
            }
            if (existing) {
                // 中间路径段被同名文件占用，直接报错比后续 createFolder 的含糊错误更清晰
                throw new Error(`ensureFolder: "${currentPath}" 已被同名文件占用，无法创建文件夹`);
            }
            await vault.createFolder(currentPath);
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
     * 使用 createBinary + UTF-8 BOM 确保跨软件兼容（防止非 Obsidian 软件打开乱码）
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

        // 以 UTF-8 + BOM 写入，确保 Windows 记事本等软件正确识别中文
        const encoder = new TextEncoder();
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const contentBytes = encoder.encode(content);
        const buffer = new Uint8Array(bom.length + contentBytes.length);
        buffer.set(bom, 0);
        buffer.set(contentBytes, bom.length);

        return vault.createBinary(finalPath, buffer.buffer);
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

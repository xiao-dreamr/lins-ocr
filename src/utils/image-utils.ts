/**
 * 图片工具类
 * 使用 Canvas API（Electron 内置）进行图片缩放和 base64 编解码。
 */
export class ImageUtils {
    /**
     * 等比缩放图片，确保长边 ≤ maxDimension
     * @param base64DataUri — `data:image/png;base64,...` 格式
     * @param maxDimension — 长边最大像素值
     * @returns 缩放后的 data URI，无需缩放时返回原值
     */
    static async resizeImage(
        base64DataUri: string,
        maxDimension: number
    ): Promise<string> {
        const mimeType = ImageUtils.getMimeType(base64DataUri) ?? 'image/png';

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const { naturalWidth: w, naturalHeight: h } = img;
                const longEdge = Math.max(w, h);

                // 无需缩放
                if (longEdge <= maxDimension) {
                    resolve(base64DataUri);
                    return;
                }

                // 计算缩放比例
                const scale = maxDimension / longEdge;
                const newW = Math.round(w * scale);
                const newH = Math.round(h * scale);

                const canvas = document.createElement('canvas');
                canvas.width = newW;
                canvas.height = newH;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas 2D context 不可用'));
                    return;
                }
                ctx.drawImage(img, 0, 0, newW, newH);

                const resized = canvas.toDataURL(mimeType);
                resolve(resized);
            };
            img.onerror = () => reject(new Error('图片加载失败，无法缩放'));
            img.src = base64DataUri;
        });
    }

    /**
     * 从 data URI 中提取 MIME 类型
     */
    static getMimeType(base64Data: string): string | null {
        const match = base64Data.match(/^data:(image\/[^;]+);base64,/);
        return match ? match[1] : null;
    }

    /**
     * 判断字符串是否为 data URI
     */
    static isDataUri(data: string): boolean {
        return data.startsWith('data:');
    }

    /**
     * 去除 data URI 前缀，返回纯 base64 字符串
     */
    static stripDataUriPrefix(dataUri: string): string {
        const idx = dataUri.indexOf(',');
        if (idx !== -1) {
            return dataUri.substring(idx + 1);
        }
        return dataUri;
    }

    /**
     * base64 → ArrayBuffer
     */
    static base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * ArrayBuffer → base64
     */
    static arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * 从文件扩展名推断扩展名对应的常见后缀
     */
    static extFromImageId(imageId: string): string {
        const parts = imageId.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'jpg';
    }
}

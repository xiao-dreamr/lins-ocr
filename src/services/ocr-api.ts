import { requestUrl } from 'obsidian';
import type { LinsOCRSettings } from '../settings';
import { FileType, DEFAULT_LAYOUT_PARAMS } from '../types';
import type { LayoutParsingResult } from '../types';
import { ImageUtils } from '../utils/image-utils';

/**
 * 给 Promise 加超时（Obsidian requestUrl 无 timeout 参数，需自行实现）。
 * @param ms — 超时毫秒数，<=0 表示不超时
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    if (!ms || ms <= 0) {
        return promise;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} 请求超时（${ms / 1000}s）`)),
            ms
        );
    });
    // 无论结果如何都清理定时器
    return Promise.race([promise, timeout]).then(
        (value) => {
            if (timer) clearTimeout(timer);
            return value;
        },
        (err) => {
            if (timer) clearTimeout(timer);
            throw err;
        }
    );
}

/**
 * OCR API 调用服务
 * 封装对 PaddleOCR-VL 的 /layout-parsing 和 /restructure-pages 端点的 HTTP 调用。
 */
export class OcrApiService {
    private settings: LinsOCRSettings;

    constructor(settings: LinsOCRSettings) {
        this.settings = settings;
    }

    updateSettings(settings: LinsOCRSettings): void {
        this.settings = settings;
    }

    /**
     * 调用 /layout-parsing 端点进行版面解析
     */
    async layoutParsing(
        base64File: string,
        fileType: FileType
    ): Promise<LayoutParsingResult[]> {
        // 服务端要求纯 base64，需剥离 data URI 前缀
        const rawBase64 = ImageUtils.stripDataUriPrefix(base64File);

        const payload = {
            ...DEFAULT_LAYOUT_PARAMS,
            file: rawBase64,
            fileType,
        };

        console.log('[LinsOCR] Calling /layout-parsing...');

        const response = await withTimeout(
            requestUrl({
                url: this.settings.layoutParsingUrl,
                method: 'POST',
                contentType: 'application/json',
                body: JSON.stringify(payload),
                throw: false,
            }),
            this.settings.requestTimeoutMs,
            'layout-parsing'
        );

        if (response.status !== 200) {
            const errorBody = (response.json as Record<string, unknown> | undefined);
            const errorMsg = errorBody?.['errorMsg'] ?? `HTTP ${response.status}`;
            throw new Error(`layout-parsing 请求失败: ${errorMsg}`);
        }

        const data = response.json as Record<string, unknown>;

        // 检查业务错误码
        if (data.errorCode !== 0) {
            throw new Error(
                `layout-parsing 错误 (errorCode=${data.errorCode}): ${data.errorMsg}`
            );
        }

        // 提取结果 — 可能在 result.layoutParsingResults 或顶层
        let results: LayoutParsingResult[];
        if (
            data.result &&
            Array.isArray((data.result as Record<string, unknown>).layoutParsingResults)
        ) {
            results = (data.result as Record<string, unknown>)
                .layoutParsingResults as LayoutParsingResult[];
        } else if (Array.isArray(data.layoutParsingResults)) {
            results = data.layoutParsingResults as LayoutParsingResult[];
        } else {
            throw new Error('layout-parsing 返回格式异常：未找到 layoutParsingResults');
        }

        console.log('[LinsOCR] /layout-parsing returned', results.length, 'result(s)');
        return results;
    }

    /**
     * 调用 /restructure-pages 端点进行页面重组
     */
    async restructurePages(
        pages: LayoutParsingResult[],
        fileType: FileType
    ): Promise<LayoutParsingResult[]> {
        const payload = {
            pages,
            fileType,
        };

        console.log('[LinsOCR] Calling /restructure-pages...');

        const response = await withTimeout(
            requestUrl({
                url: this.settings.restructurePagesUrl,
                method: 'POST',
                contentType: 'application/json',
                body: JSON.stringify(payload),
                throw: false,
            }),
            this.settings.requestTimeoutMs,
            'restructure-pages'
        );

        if (response.status !== 200) {
            const errorBody = (response.json as Record<string, unknown> | undefined);
            const errorMsg = errorBody?.['errorMsg'] ?? `HTTP ${response.status}`;
            throw new Error(`restructure-pages 请求失败: ${errorMsg}`);
        }

        const data = response.json as Record<string, unknown>;

        if (data.errorCode !== 0) {
            throw new Error(
                `restructure-pages 错误 (errorCode=${data.errorCode}): ${data.errorMsg}`
            );
        }

        let results: LayoutParsingResult[];
        if (
            data.result &&
            Array.isArray((data.result as Record<string, unknown>).layoutParsingResults)
        ) {
            results = (data.result as Record<string, unknown>)
                .layoutParsingResults as LayoutParsingResult[];
        } else if (Array.isArray(data.layoutParsingResults)) {
            results = data.layoutParsingResults as LayoutParsingResult[];
        } else {
            throw new Error('restructure-pages 返回格式异常：未找到 layoutParsingResults');
        }

        console.log('[LinsOCR] /restructure-pages returned', results.length, 'result(s)');
        return results;
    }
}

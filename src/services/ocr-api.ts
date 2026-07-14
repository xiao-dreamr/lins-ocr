import { requestUrl } from 'obsidian';
import type { LinsOCRSettings } from '../settings';
import { FileType, DEFAULT_LAYOUT_PARAMS } from '../types';
import type { LayoutParsingResult } from '../types';
import { ImageUtils } from '../utils/image-utils';

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

        const response = await requestUrl({
            url: this.settings.layoutParsingUrl,
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify(payload),
            throw: false,
        });

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

        const response = await requestUrl({
            url: this.settings.restructurePagesUrl,
            method: 'POST',
            contentType: 'application/json',
            body: JSON.stringify(payload),
            throw: false,
        });

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

// ---- PaddleOCR-VL API 响应类型 ----

export interface HealthResponse {
    logId: string;
    errorCode: number;
    errorMsg: string;
}

export interface MarkdownData {
    text: string;
    images: Record<string, string>;  // imageId -> base64 (可能含 data URI 前缀)
}

export interface LayoutParsingResult {
    prunedResult: Record<string, unknown>;
    markdown?: MarkdownData;
    outputImages?: Record<string, string>;
    inputImage?: string;
}

export interface ApiResponse {
    logId: string;
    errorCode: number;
    errorMsg: string;
    result?: {
        layoutParsingResults: LayoutParsingResult[];
        dataInfo?: Record<string, unknown>;
    };
    // 某些版本直接返回顶层
    layoutParsingResults?: LayoutParsingResult[];
}

// ---- 请求 payload 类型 ----

export interface LayoutParsingRequest {
    file: string;                    // base64 编码的文件内容
    fileType: number;                // 0 = PDF, 1 = IMAGE
    useLayoutDetection: boolean;
    useChartRecognition: boolean;
    useSealRecognition: boolean;
    useOcrForImageBlock: boolean;
    useDocOrientationClassify: boolean;
    useDocUnwarping: boolean;
    promptLabel: string;
    minPixels: number;
    maxPixels: number;
    maxNewTokens: number;
    returnMarkdownImages: boolean;
    prettifyMarkdown: boolean;
    mergeLayoutBlocks: boolean;
    restructurePages: boolean;
    mergeTables: boolean;
    relevelTitles: boolean;
    showFormulaNumber: boolean;
    markdownIgnoreLabels: string[];
}

// ---- 枚举与常量 ----

export enum FileType {
    PDF = 0,
    IMAGE = 1,
}

export const SUPPORTED_IMAGE_EXTENSIONS = [
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'svg'
];

export const SUPPORTED_PDF_EXTENSIONS = ['pdf'];

// PaddleOCR-VL 默认参数
// 注意：temperature 和 topP 本地模型不支持，发送会产生 UserWarning，已移除
export const DEFAULT_LAYOUT_PARAMS: Omit<LayoutParsingRequest, 'file' | 'fileType'> = {
    useLayoutDetection: true,
    useChartRecognition: false,
    useSealRecognition: false,
    useOcrForImageBlock: false,
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    promptLabel: 'ocr',
    minPixels: 112896,
    maxPixels: 1003520,
    maxNewTokens: 4096,
    returnMarkdownImages: true,
    prettifyMarkdown: true,
    mergeLayoutBlocks: true,
    restructurePages: false,
    mergeTables: true,
    relevelTitles: true,
    showFormulaNumber: false,
    markdownIgnoreLabels: ['header', 'footer', 'footnote'],
};

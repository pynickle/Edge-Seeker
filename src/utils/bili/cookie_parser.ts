/**
 * Bilibili Cookie 提取工具（单值专用版）
 *
 * 为了避免无谓的全量提取，这里为每个常见 Cookie 键提供专用提取函数。
 * 每个函数只搜索并返回对应值，高效且专注。
 *
 * 通用逻辑：
 * - 用 ';' 分割 Cookie 字符串。
 * - 遍历每个部分，trim() 后用 '=' 分割键值。
 * - 匹配特定键时，提取值并返回（保持 URL 编码原样）。
 * - 未找到返回 undefined。
 *
 * 如果需要解码值，可在函数末尾加：return value ? decodeURIComponent(value) : undefined;
 *
 * 用法：import { extractSESSDATA } from './this-file'; const ses = extractSESSDATA(cookieStr);
 */

// 定义 Bilibili Cookie 的接口（可选，用于类型提示）
export interface BiliCookies {
    buvid3: string;
    SESSDATA: string;
    bili_jct: string;
    DedeUserID: string;
    DedeUserID__ckMd5: string;
    sid: string;
}

/**
 * 通用辅助函数：从 Cookie 字符串中提取指定键的值
 * @param cookieString - Cookie 字符串
 * @param key - 要提取的键名
 * @returns 值字符串或 undefined
 */
function extractValue(cookieString: string, key: string): string | undefined {
    if (!cookieString) return undefined;

    const parts = cookieString.split(';');
    for (const part of parts) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;

        const indexOfEquals = trimmedPart.indexOf('=');
        if (indexOfEquals === -1) continue;

        const partKey = trimmedPart.substring(0, indexOfEquals).trim();
        const value = trimmedPart.substring(indexOfEquals + 1).trim();

        if (partKey === key) {
            return value;
        }
    }
    return undefined;
}

export function extractBuvid3(cookieString: string): string | undefined {
    return extractValue(cookieString, 'buvid3');
}

export function extractSESSDATA(cookieString: string): string | undefined {
    return extractValue(cookieString, 'SESSDATA');
}

export function extractBiliJct(cookieString: string): string | undefined {
    return extractValue(cookieString, 'bili_jct');
}

export function extractDedeUserID(cookieString: string): string | undefined {
    return extractValue(cookieString, 'DedeUserID');
}

export function extractDedeUserIDCkMd5(cookieString: string): string | undefined {
    return extractValue(cookieString, 'DedeUserID__ckMd5');
}

export function extractSid(cookieString: string): string | undefined {
    return extractValue(cookieString, 'sid');
}

export function parseAllBiliCookies(cookieString: string): Partial<BiliCookies> {
    return {
        buvid3: extractBuvid3(cookieString),
        SESSDATA: extractSESSDATA(cookieString),
        bili_jct: extractBiliJct(cookieString),
        DedeUserID: extractDedeUserID(cookieString),
        DedeUserID__ckMd5: extractDedeUserIDCkMd5(cookieString),
        sid: extractSid(cookieString),
    };
}

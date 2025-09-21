import {readFileSync} from "node:fs";
import {join, relative} from 'path'
import {readFile} from "node:fs/promises";

/**
 * 获取本地字体的base64编码
 */
export async function getFontBase64(fontFileName: string): Promise<string> {
    try {
        // 使用正确的包名路径
        const fontPath = getAssetPath(fontFileName);

        const fontBuffer = await readFile(fontPath)
        return fontBuffer.toString('base64')
    } catch (error) {
        return '';
    }
}

export function getAssetPath(assetFileName: string): string {
    return join(process.cwd(), 'node_modules', 'koishi-plugin-edge-seeker', 'assets', assetFileName)
}
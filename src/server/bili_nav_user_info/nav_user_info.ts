import {Context} from 'koishi'
import {Config} from "../../index";
import axios from "axios";

export const name = 'nav-user-info'

async function getBilibiliNav(data) {
    const sessdataMatch = data.match(/SESSDATA=([^;]+)/);
    if (!sessdataMatch) {
        console.error('SESSDATA not found in cookie string');
        return;
    }

    const url = `https://api.bilibili.com/x/web-interface/nav`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Cookie': data
        },
    })

    if (!response.ok) {
        console.error('Network response was not ok', response.statusText);
        return;
    }

    return await response.json()
}

export function nav_user_info(ctx: Context, config: Config) {
    ctx.server.all("/api/user-info", async (koaCtx: any, next) => {
        // 设置CORS头
        koaCtx.set('Access-Control-Allow-Origin', '*')
        koaCtx.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
        koaCtx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

        if (koaCtx.method === 'OPTIONS') {
            ctx.logger("cookie").info(`处理OPTIONS预检请求: ${koaCtx.path}`)
            koaCtx.status = 200
            return
        }

        if (koaCtx.method !== 'POST') {
            koaCtx.status = 405
            koaCtx.body = { error: { message: 'Method Not Allowed', type: 'invalid_request_error' } }
            return
        }

        await next()
    })

    ctx.server.post('/api/user-info', async (koaCtx: any) => {
        try {
            // 解析 JSON 请求体
            let body = koaCtx.request.body;
            if (!body) {
                koaCtx.response.body = { error: 'Invalid JSON body' };
                return koaCtx.status = 400;
            }

            const cookie = body["cookie"];
            if (!cookie) {
                koaCtx.response.body = { error: "Missing required fields cookie" };
                return koaCtx.status = 400;
            }

            const cookieInfo = await getBilibiliNav(cookie);
            if (cookieInfo.length === 0 || cookieInfo.code !== 0) {
                koaCtx.response.body = { error: 'Failed to get user info' };
                return koaCtx.status = 400;
            }

            const face = cookieInfo.data.face;
            const base64 = await loadImageAsBase64(face);
            koaCtx.response.body = {...cookieInfo, faceBase64: base64}
            koaCtx.status = 200;
        } catch (error) {
            ctx.logger("cookie").error('Bind cookie error:', error)
            koaCtx.response.body = { error: 'Internal server error' }
            koaCtx.status = 500;
        }
    })
}

async function loadImageAsBase64(imageUrl: string): Promise<string> {
    try {
        // Step 1: 使用 axios 获取图片作为 buffer
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Node.js)',
            },
        });

        // Step 2: 从响应头获取 MIME 类型（fallback 到 image/png）
        const mimeType = response.headers['content-type'] || 'image/png';

        // Step 3: 将 buffer 转换为 base64，并构造完整 data URL
        const base64Data = Buffer.from(response.data, 'binary').toString('base64');
        return `data:${mimeType};base64,${base64Data}`;
    } catch (error) {
        console.error('Error loading image:', error);
        throw error;
    }
}
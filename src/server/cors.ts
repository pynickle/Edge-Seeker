import { Context } from 'koishi';
import { Config } from '../index';

export function cors(ctx: Context, config: Config) {
    ctx.server.all(/^\/api(?:\/.*)?$/, async (koaCtx: any, next) => {
        // 设置 CORS 头
        koaCtx.set('Access-Control-Allow-Origin', '*');
        koaCtx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        koaCtx.set(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Requested-With'
        );

        ctx.logger('cors').info(`处理请求：${koaCtx.method} ${koaCtx.path}`);

        if (koaCtx.method === 'OPTIONS') {
            ctx.logger('cookie').info(`处理 OPTIONS 预检请求：${koaCtx.path}`);
            koaCtx.status = 200;
            return;
        }

        if (koaCtx.method !== 'POST') {
            koaCtx.status = 405;
            koaCtx.body = {
                error: {
                    message: 'Method Not Allowed',
                    type: 'invalid_request_error',
                },
            };
            return;
        }

        await next();
    });
}

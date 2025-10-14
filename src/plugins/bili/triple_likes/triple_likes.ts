import axios from 'axios';
import { Context } from 'koishi';
import { Config } from '../../../index';
import {
    extractBiliJct,
    extractBuvid3,
} from '../../../utils/bili/cookie_parser';
import { getWbiKeys, initWbiKeysCache } from '../../../utils/bili/wbi_helper';
import { getRandomUserAgent } from '../../../utils/web/web_helper';

// 插件主函数
export const name = 'triple_likes';

export function triple_likes(ctx: Context, config: Config) {
    initWbiKeysCache(ctx);

    ctx.command(
        'bili.triple <bvid:string>',
        '对 B 站视频进行一键三连，请使用浏览器 cookie 绑定'
    ).action(async ({ session }, bvid) => {
        if (!bvid) return '请提供视频的 bvid 参数';

        // 验证 bvid 格式（简单验证）
        if (!/^BV[A-Za-z0-9]{10,12}$/.test(bvid)) {
            return `bvid 格式不正确：${bvid}`;
        }

        // 获取用户绑定的B站账号信息
        const userId = session.userId;
        const userInfo = await ctx.database.get('user_bili_info', {
            userId,
        });

        if (!userInfo || userInfo.length === 0) {
            return '请先绑定B站账号：/bili.bind';
        }

        const user = userInfo[0];
        let cookie = user.cookie;
        const mid = user.mid;

        if (!cookie) {
            return '绑定信息不完整，请重新绑定：/bili.bind';
        }

        const buvid3 = extractBuvid3(cookie);
        if (!buvid3) {
            return '绑定的账号缺少必要的 buvid3 信息，可能会触发风控，请重新绑定：/bili.bind';
        }

        const biliJct = extractBiliJct(cookie);
        if (!biliJct) {
            return '无法从 cookie 中提取 CSRF Token，请重新绑定：/bili.bind';
        }

        try {
            // 获取 WBI Keys
            const wbiKeys = await getWbiKeys(ctx, cookie, mid);
            if (!wbiKeys) {
                return '获取 WBI Keys 失败，无法执行一键三连';
            }

            // 构建请求参数
            const params = {
                bvid,
                csrf: biliJct,
            };

            // 构建请求头
            const headers = {
                Cookie: cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://www.bilibili.com/',
                Origin: 'https://www.bilibili.com',
                'User-Agent': getRandomUserAgent(),
            };

            // 发送一键三连请求
            const response = await axios.post(
                'https://api.bilibili.com/x/web-interface/archive/like/triple',
                new URLSearchParams(params),
                {
                    headers,
                }
            );

            const data = response.data;

            // 处理响应
            if (data.code === 0) {
                const result = data.data;
                let successMsg = `一键三连成功！\n视频：BV${bvid.replace('BV', '')}\n`;
                successMsg += `点赞: ${result.like ? '✓' : '✗'}\n`;
                successMsg += `投币: ${result.coin ? '✓' : '✗'} (${result.multiply}枚)\n`;
                successMsg += `收藏: ${result.fav ? '✓' : '✗'}`;
                return successMsg;
            } else {
                let errorMsg = `一键三连失败 (${data.code}): ${data.message || '未知错误'}\n`;
                switch (data.code) {
                    case -101:
                        errorMsg += '账号未登录，请重新绑定';
                        break;
                    case -111:
                        errorMsg += 'CSRF 校验失败，请重新绑定';
                        break;
                    case 10003:
                        errorMsg += '不存在该稿件，请检查 bvid 是否正确';
                        break;
                    case -403:
                        errorMsg +=
                            '账号异常，请确定你使用网页 cookie 绑定 B 站账号';
                        break;
                    case -400:
                        errorMsg += '请求错误，请检查参数';
                        break;
                    default:
                        errorMsg += '请稍后重试';
                }
                return errorMsg;
            }
        } catch (error) {
            ctx.logger('bili-triple').error('一键三连请求失败:', error);
            return `一键三连失败：${error instanceof Error ? error.message : '未知错误'}`;
        }
    });
}

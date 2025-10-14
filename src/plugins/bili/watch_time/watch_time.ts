import { Context } from 'koishi';
import { Config } from '../../../index';
import { extractBiliJct } from '../../../utils/bili/cookie_parser';
import { getRandomUserAgent } from '../../../utils/web/web_helper';

// 插件名称
export const name = 'bili-watch-time';

// 格式化观看时长
function formatWatchTime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    let result = '';
    if (days > 0) result += `${days}天`;
    if (hours > 0) result += `${hours}小时`;
    if (minutes > 0) result += `${minutes}分钟`;
    if (remainingSeconds > 0 || result === '')
        result += `${remainingSeconds}秒`;

    return result;
}

// 插件主函数
export function watch_time(ctx: Context, config: Config) {
    // 注册命令
    ctx.command(
        'bili.watch_time <ruid:number>',
        '查询自己在某 B 站直播间的观看时长'
    ).action(async ({ session }, ruid) => {
        if (!ruid) return '请提供主播的uid参数';

        // 验证ruid格式
        if (!Number.isInteger(ruid) || ruid <= 0) {
            return `主播 uid 格式不正确：${ruid}`;
        }

        const userId = session.userId;
        const userInfo = await ctx.database.get('user_bili_info', {
            userId,
        });

        if (!userInfo || userInfo.length === 0) {
            return '请先绑定 B 站账号：/bili.bind';
        }

        const user = userInfo[0];
        let cookie = user.cookie;
        const mid = user.mid;

        if (!cookie) {
            return '绑定信息不完整，请重新绑定：/bili.bind';
        }

        try {
            // 构建请求头
            const headers = {
                Cookie: cookie,
                'User-Agent': getRandomUserAgent(),
                Referer: `https://live.bilibili.com/`,
                Origin: 'https://live.bilibili.com',
            };

            // 构建请求URL
            const url = `https://api.live.bilibili.com/xlive/general-interface/v1/guard/GuardActive?platform=android&ruid=${ruid}`;

            // 发送请求
            const response = await ctx.http.get(url, {
                headers,
            });

            const data = response.data;

            // 处理响应
            if (data.code === 0 && data.data) {
                const result = data.data;
                const watchTime = result.watch_time || 0;
                const formattedWatchTime = formatWatchTime(watchTime);

                let message = `🎬 直播间观看时长查询结果\n`;
                message += `📺 主播：${result.rusername || '未知'}\n`;
                message += `👤 用户名：${result.username || '未知'}\n`;
                message += `⏱️ 观看时长：${formattedWatchTime}\n`;

                // 如果有大航海信息，也显示出来
                if (result.accomany_day !== undefined) {
                    message += `🚢 大航海陪伴天数：${result.accomany_day}天\n`;
                }

                // 显示直播间状态
                if (result.is_live !== undefined) {
                    message += `📡 直播状态：${result.is_live === 1 ? '直播中' : '未开播'}\n`;
                }

                // 显示粉丝牌信息
                if (result.up_medal) {
                    const medal = result.up_medal;
                    if (medal.medal_name && medal.level) {
                        message += `🏅 粉丝牌：${medal.medal_name} Lv.${medal.level}`;
                    }
                }

                return message;
            } else {
                let errorMsg = `查询失败 (${data.code}): ${data.message || '未知错误'}\n`;
                switch (data.code) {
                    case -101:
                        errorMsg += '账号未登录，请重新绑定';
                        break;
                    case -403:
                        errorMsg +=
                            '账号异常，请确定你使用网页cookie绑定B站账号';
                        break;
                    case 400:
                        errorMsg += '请求错误，请检查参数';
                        break;
                    default:
                        errorMsg += '请稍后重试';
                }
                return errorMsg;
            }
        } catch (error) {
            ctx.logger('bili-watch-time').error('观看时长查询请求失败:', error);
            return `查询失败：${error instanceof Error ? error.message : '未知错误'}`;
        }
    });
}

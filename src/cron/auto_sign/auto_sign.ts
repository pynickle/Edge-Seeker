import { Config } from '../../index';
import 'koishi-plugin-cron';
import { Context } from 'koishi';

export const name = 'auto_sign';

export function auto_sign(ctx: Context, config: Config) {
    // 定义 cron 任务，每天 0:00 执行
    ctx.cron('0 0 * * *', async () => {
        const bot = ctx.bots[0];

        if (bot.internal?.sendGroupSign) {
            for (const groupId of config.auto_sign.groupIds) {
                try {
                    await bot.internal._request('set_group_sign', { groupId });
                    ctx.logger.info(`已在群 ${groupId} 发送打卡请求`);
                } catch (error) {
                    ctx.logger.warn(`自动打卡失败（群 ${groupId}）: ${error}`);
                }
            }
        }
    });
}

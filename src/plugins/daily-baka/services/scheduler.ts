import '@pynickle/koishi-plugin-adapter-onebot';
import { Context } from 'koishi';
import {
    formatProbabilityTable,
    generateInitialProbabilities,
    generateInitialProbabilitiesWithoutSession,
} from '../utils/helper';

export function registerDailyJob(ctx: Context, enabledGroups: string[]) {
    ctx.cron('0 0 * * *', async () => {
        for (const channelId of enabledGroups) {
            const bot = ctx.bots[0];
            if (!bot) continue;

            const users = await bot.internal.getGroupMemberList(channelId);
            const newProbs = await generateInitialProbabilitiesWithoutSession(
                ctx,
                channelId,
                users.map((u) => u.userId)
            );
            await ctx.database.remove('probability', { channelId });
            for (const { userId, probability } of newProbs) {
                await ctx.database.create('probability', {
                    userId,
                    channelId,
                    probability,
                });
            }

            // 随机选出每日笨蛋
            const random = Math.random() * 100;
            let cumulative = 0;
            let chosen: string = null;
            for (const { userId, probability } of newProbs) {
                cumulative += probability;
                if (random <= cumulative) {
                    chosen = userId;
                    break;
                }
            }

            if (chosen)
                await bot.sendMessage(
                    channelId,
                    `🎉🎊 今日的笨蛋产生啦～\n👀 是：${chosen}！\n🎲 恭喜"中奖"～\n🔄 概率已重新洗牌，明天又是新的开始！`
                );
        }
    });
}

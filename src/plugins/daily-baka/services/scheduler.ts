import '@pynickle/koishi-plugin-adapter-onebot';
import { Context } from 'koishi';
import { getUserNameWithoutSession } from '../../../utils/onebot_helper';
import { generateInitialProbabilitiesWithoutSession } from '../utils/helper';

// 预告功能：显示概率前三的危险分子
async function sendDailyPreview(ctx: Context, channelId: string) {
    const bot = ctx.bots[0];
    if (!bot) return;

    // 获取当前概率数据
    const currentProbs = await ctx.database.get('probability', { channelId });
    if (currentProbs.length === 0) return;

    // 按概率从高到低排序，取前三名
    const topThree = currentProbs
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 3);

    // 获取用户名
    const topThreeWithNames = await Promise.all(
        topThree.map(async (record) => ({
            userId: record.userId,
            userName: await getUserNameWithoutSession(
                ctx,
                channelId,
                record.userId
            ),
            probability: record.probability,
        }))
    );

    // 生成预告文本
    const previewText =
        `🚨 午夜凶铃即将响起～\n🎲 今日概率前三的"危险分子"：\n` +
        topThreeWithNames
            .map((user, index) => {
                const emojis = ['🥇', '🥈', '🥉'];
                const emoji = emojis[index];
                return `${emoji} ${user.userName}：${user.probability.toFixed(2)}%`;
            })
            .join('\n') +
        `\n⏰ 1 分钟后正式揭晓今日笨蛋～`;

    await bot.sendMessage(channelId, previewText);
}

// 正式公布功能
export async function finalizeDailySelection(ctx: Context, channelId: string) {
    const bot = ctx.bots[0];
    if (!bot) return;

    const users = await bot.internal.getGroupMemberList(channelId);
    const newProbs = await generateInitialProbabilitiesWithoutSession(
        ctx,
        channelId,
        users.map((u) => u.user_id),
    );

    // 移除旧概率
    await ctx.database.remove('probability', { channelId });

    // 创建新概率记录（带用户名）
    for (const { userId, userName, probability } of newProbs) {
        await ctx.database.create('probability', {
            userId,
            userName,
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

    if (chosen) {
        const chosenUserName =
            newProbs.find((p) => p.userId === chosen)?.userName || chosen;
        await bot.sendMessage(
            channelId,
            `🎉🎊 今日笨蛋诞生啦～\n👀 就是：${chosenUserName}！\n🎲 恭喜"中奖"～\n🔄 概率已重新洗牌，明天又是新的开始！`
        );
    }
}

export function registerDailyJob(ctx: Context, enabledGroups: string[]) {
    // 0 点 0 分：发送预告
    ctx.cron('0 0 * * *', async () => {
        for (const channelId of enabledGroups) {
            await sendDailyPreview(ctx, channelId);
        }
    });

    // 0 点 1 分：正式公布
    ctx.cron('1 0 * * *', async () => {
        for (const channelId of enabledGroups) {
            await finalizeDailySelection(ctx, channelId);
        }
    });
}

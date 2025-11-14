import { Context } from 'koishi';
import { Config } from '../../index';
import { createTextMsgNode, getUserName } from '../../utils/onebot_helper';
import { StarCoinHelper } from '../../utils/starcoin_helper';
import { requestAIAdjustProbabilities } from './services/ai-service';
import { registerDailyJob } from './services/scheduler';
import {
    MessageRecord,
    ProbabilityRecord,
    apply as setupDatabase,
} from './utils/database';
import {
    formatProbabilityTable,
    generateInitialProbabilities,
} from './utils/helper';

export const name = 'daily-baka';

declare module 'koishi' {
    interface Tables {
        probability: ProbabilityRecord;
        messages: MessageRecord;
    }
}

export function daily_baka(ctx: Context, config: Config) {
    setupDatabase(ctx);
    registerDailyJob(ctx, config.daily_doofus.enabledGroups);

    const STAR_VALUE_PROMPT = `- 50 星币 ≈ 一句特别有影响力或改变性强的话。\n- 100 星币 ≈ 明显改变一个人的概率。\n- 300 星币 ≈ 强烈影响最终分配结果。`;

    // 手动生成初始概率
    ctx.command('baka.init', '生成初始概率', { authority: 4 }).action(
        async ({ session }) => {
            const { channelId } = session;

            if (!config.daily_doofus.enabledGroups.includes(channelId))
                return '🚫 此群未启用每日笨蛋功能哦～';

            const users = await session.onebot.getGroupMemberList(channelId);

            const newProbs = await generateInitialProbabilities(
                ctx,
                session,
                users.map((u) => u.user_id.toString())
            );
            await ctx.database.remove('probability', {
                channelId,
            });

            for (const { userId, userName, probability } of newProbs) {
                await ctx.database.create('probability', {
                    userId,
                    userName,
                    channelId,
                    probability,
                });
            }

            const botName =
                (await getUserName(this.ctx, session, session.bot?.userId)) ||
                'Bot';

            await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
                createTextMsgNode(
                    session.bot?.userId,
                    botName,
                    '🎯 初始化完成啦！大家的笨蛋概率都重新洗牌～'
                ),
                createTextMsgNode(
                    session.bot?.userId,
                    botName,
                    formatProbabilityTable(newProbs)
                ),
            ]);
        }
    );

    // 查看自己概率
    ctx.command('baka.prob', '查看自己的笨蛋概率').action(
        async ({ session }) => {
            const { userId, channelId } = session;

            const record = await ctx.database.get('probability', {
                userId,
                channelId,
            });

            if (!record.length) return '📊 还没有数据呢～需要先初始化概率哦！';
            return `📈 你当前的笨蛋概率为 ${record[0].probability.toFixed(2)}%`;
        }
    );

    // 管理员查看全体概率
    ctx.command('baka.prob.all', '查看全体笨蛋概率', { authority: 4 }).action(
        async ({ session }) => {
            const botName =
                (await getUserName(this.ctx, session, session.bot?.userId)) ||
                'Bot';

            const records = await ctx.database.get('probability', {
                channelId: session.channelId,
            });

            await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
                createTextMsgNode(
                    session.bot?.userId,
                    botName,
                    '🎲 今日笨蛋概率新鲜出炉啦～'
                ),
                createTextMsgNode(
                    session.bot?.userId,
                    botName,
                    formatProbabilityTable(records)
                ),
            ]);
        }
    );

    ctx.command('baka.chat <message:text>', '与每日笨蛋 AI 对话')
        .option('stars', '-s <stars:number> 消耗星币数量')
        .action(async ({ session, options }, message) => {
            const { channelId, userId, username } = session;

            if (!config.daily_doofus.enabledGroups.includes(channelId))
                return '🚫 此群未启用每日笨蛋功能哦～';

            const count = (
                await ctx.database.get('messages', {
                    userId: userId,
                    channelId,
                    timestamp: { $gte: Date.now() - 24 * 3600 * 1000 },
                })
            ).length;
            if (count >= config.daily_doofus.dailyMessageLimit)
                return `😴 你今天的对话次数已用完啦～（${config.daily_doofus.dailyMessageLimit} 次）明天再来吧！`;

            const starsUsed = options.stars ?? 0;

            const hasEnough = await StarCoinHelper.hasEnoughStarCoin(
                ctx,
                userId,
                channelId,
                starsUsed
            );
            if (!hasEnough) {
                const currentStarCoin = await StarCoinHelper.getUserStarCoin(
                    ctx,
                    userId,
                    channelId
                );
                await session.send(
                    `💸 @${username}，星币不够啦～ 当前星币：${currentStarCoin}，需要：${starsUsed}，快去赚点星币吧！`
                );
                return;
            }

            // 扣除星币
            const success = await StarCoinHelper.removeUserStarCoin(
                ctx,
                userId,
                channelId,
                starsUsed
            );

            if (!success) {
                await session.send(
                    `😵 @${username}，星币扣除失败啦，请稍后再试哦～`
                );
                return;
            }

            const messages = await ctx.database.get('messages', {
                channelId,
            });

            const probs = await ctx.database.get('probability', {
                channelId,
            });

            // 记录原始概率
            const originalProb =
                probs.find((p) => p.userId === userId)?.probability || 0;

            await session.send('🤔 正在和 AI 沟通中，请稍候～');

            const result = await requestAIAdjustProbabilities(
                config.daily_doofus.apiKey,
                config.daily_doofus.apiUrl,
                userId,
                username,
                message,
                starsUsed,
                messages,
                probs,
                STAR_VALUE_PROMPT
            );

            await ctx.database.create('messages', {
                userId,
                channelId,
                content: message,
                timestamp: Date.now(),
                starsUsed,
            });

            for (const change of result.changes) {
                await ctx.database.set(
                    'probability',
                    { userId: change.userId, channelId: session.channelId },
                    { probability: change.probability }
                );
            }

            // 获取更新后的概率
            const updatedProb =
                result.changes.find((c) => c.userId === userId)?.probability ||
                originalProb;

            const probChange = updatedProb - originalProb;
            const changeText =
                probChange > 0
                    ? `⬆️ 增加了 ${probChange.toFixed(2)}%`
                    : probChange < 0
                      ? `⬇️ 减少了 ${Math.abs(probChange).toFixed(2)}%`
                      : '➡️ 没有变化';

            return `✨ AI 已完成分析！概率已更新\n📊 你的笨蛋概率：${originalProb.toFixed(2)}% → ${updatedProb.toFixed(2)}% (${changeText})\n🎉 希望能逃过明天的"每日笨蛋"哦～`;
        });
}

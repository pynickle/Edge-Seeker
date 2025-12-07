import { getUserName, getUserNameWithoutSession } from '../../../utils/onebot_helper';
import { Context, Session } from 'koishi';

export async function generateInitialProbabilities(
    ctx: Context,
    session: Session,
    users: string[]
) {
    const base = 100 / users.length;

    return Promise.all(
        users.map(async (userId) => ({
            userId,
            userName: await getUserName(ctx, session, userId.toString()),
            probability: base,
        }))
    );
}

export async function generateInitialProbabilitiesWithoutSession(
    ctx: Context,
    channelId: string,
    users: string[]
) {
    const base = 100 / users.length;

    return Promise.all(
        users.map(async (userId) => ({
            userId,
            userName: await getUserNameWithoutSession(ctx, channelId, userId),
            probability: base,
        }))
    );
}

export function formatProbabilityTable(
    records: { userId: string; userName: string; probability: number }[]
) {
    // 按概率从大到小排序
    const sortedRecords = [...records].sort((a, b) => b.probability - a.probability);

    // 定义排名对应的 emoji
    const rankEmojis = ['🥇', '🥈', '🥉', '🔟', '🎖️', '🏵️', '✨', '💫', '🌟', '⭐'];

    return (
        '🎲 当前笨蛋概率排行榜：\n' +
        sortedRecords
            .map((r, index) => {
                const rankEmoji = rankEmojis[index] || '🔢';
                return `${rankEmoji} ${r.userName}: ${r.probability.toFixed(2)}%`;
            })
            .join('\n')
    );
}

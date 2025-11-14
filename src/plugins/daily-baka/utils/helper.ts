import { Context, Session } from 'koishi';
import {
    getUserName,
    getUserNameWithoutSession,
} from '../../../utils/onebot_helper';

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
            userName: await getUserNameWithoutSession(
                ctx,
                channelId,
                userId.toString()
            ),
            probability: base,
        }))
    );
}

export function formatProbabilityTable(
    records: { userId: string; userName: string; probability: number }[]
) {
    return (
        '📋 当前概率分布：\n' +
        records
            .map(
                (r) =>
                    `👤 ${r.userName} (${r.userId}): ${r.probability.toFixed(2)}%`
            )
            .join('\n')
    );
}

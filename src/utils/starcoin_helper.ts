import { Context } from 'koishi';

/**
 * 星币操作工具类
 */
export class StarCoinHelper {
    /**
     * 获取用户星币数量
     */
    public static async getUserStarCoin(
        ctx: Context,
        userId: string,
        channelId: string
    ): Promise<number> {
        const records = await ctx.database
            .select('sign_in')
            .where({ userId, channelId })
            .execute();
        return records.length > 0 ? records[0].starCoin : 0;
    }

    /**
     * 设置用户星币数量
     */
    public static async setUserStarCoin(
        ctx: Context,
        userId: string,
        channelId: string,
        amount: number
    ): Promise<boolean> {
        // 验证星币数量
        if (amount < 0 || !Number.isInteger(amount)) {
            return false;
        }

        try {
            const now = new Date().getTime();

            // 更新或创建用户记录
            await ctx.database.upsert(
                'sign_in',
                [
                    {
                        userId,
                        channelId,
                        starCoin: amount,
                        consecutiveDays: 0,
                        lastSignIn: now,
                    },
                ],
                ['userId', 'channelId']
            );

            return true;
        } catch (error) {
            ctx.logger.warn('设置星币失败:', error);
            return false;
        }
    }

    /**
     * 增加用户星币数量
     */
    public static async addUserStarCoin(
        ctx: Context,
        userId: string,
        channelId: string,
        amount: number
    ): Promise<boolean> {
        // 验证星币数量
        if (amount <= 0 || !Number.isInteger(amount)) {
            return false;
        }

        try {
            // 获取用户记录
            const records = await ctx.database
                .select('sign_in')
                .where({ userId, channelId })
                .execute();

            const now = new Date().getTime();

            if (records.length > 0) {
                // 用户已存在，更新星币数量
                const currentStarCoin = records[0].starCoin;
                const newStarCoin = currentStarCoin + amount;
                await ctx.database.set(
                    'sign_in',
                    { userId, channelId },
                    { starCoin: newStarCoin }
                );
            } else {
                // 用户不存在，创建新记录
                await ctx.database.upsert(
                    'sign_in',
                    [
                        {
                            userId,
                            channelId,
                            starCoin: amount,
                            consecutiveDays: 0,
                            lastSignIn: now,
                        },
                    ],
                    ['userId', 'channelId']
                );
            }

            return true;
        } catch (error) {
            ctx.logger.warn('增加星币失败：', error);
            return false;
        }
    }

    /**
     * 减少用户星币数量
     */
    public static async removeUserStarCoin(
        ctx: Context,
        userId: string,
        channelId: string,
        amount: number
    ): Promise<boolean> {
        // 验证星币数量
        if (amount < 0 || !Number.isInteger(amount)) {
            ctx.logger.info(amount);
            return false;
        }

        try {
            // 获取用户记录
            const records = await ctx.database
                .select('sign_in')
                .where({ userId, channelId })
                .execute();

            if (records.length === 0) {
                // 用户不存在，视为失败
                return false;
            }

            // 确保星币数量不为负
            const currentStarCoin = records[0].starCoin;
            const newStarCoin = Math.max(0, currentStarCoin - amount);

            await ctx.database.set(
                'sign_in',
                { userId, channelId },
                { starCoin: newStarCoin }
            );

            return true;
        } catch (error) {
            ctx.logger.warn('减少星币失败:', error);
            return false;
        }
    }

    /**
     * 检查用户星币是否足够
     */
    public static async hasEnoughStarCoin(
        ctx: Context,
        userId: string,
        channelId: string,
        amount: number
    ): Promise<boolean> {
        if (amount <= 0) {
            return true; // 不需要检查负数或零
        }

        const userStarCoin = await this.getUserStarCoin(ctx, userId, channelId);
        return userStarCoin >= amount;
    }
}

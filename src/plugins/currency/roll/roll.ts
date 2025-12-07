import { Config } from '../../../index';
import { useConfirmationHelper } from '../../../utils/confirmation_helper';
import { randomFloat, randomInt } from '../../../utils/pseudo_random_helper';
import { StarCoinHelper } from '../../../utils/starcoin_helper';
import { getTodayString } from '../../../utils/time_helper';
import { Context, Session } from 'koishi';

// 定义抽奖记录表结构
interface RollRecord {
    id: number;
    userId: string;
    channelId: string;
    date: string;
    totalCost: number;
    totalReward: number;
    count: number;
}

// 声明数据表
declare module 'koishi' {
    interface Tables {
        rolls: RollRecord;
    }
}

// 抽奖配置
interface RollConfig {
    cost: number;
    rewards: Array<{
        min: number;
        max: number;
        weight: number;
        message: (amount: number) => string;
    }>;
}

export const name = 'roll';

export function roll(ctx: Context, config: Config) {
    // 确保数据表存在 - 使用每日统计的方式，而不是每次抽奖记录
    ctx.database.extend(
        'rolls',
        {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            date: 'string',
            totalCost: 'unsigned', // 当日总消耗星币
            totalReward: 'unsigned', // 当日总获得星币
            count: 'unsigned', // 当日抽奖次数
        },
        {
            primary: 'id',
            autoInc: true,
            unique: [['userId', 'channelId', 'date']],
        }
    );

    // 初始化确认管理器
    const confirmationManager = useConfirmationHelper(ctx);

    // 默认抽奖配置
    const DEFAULT_ROLL_CONFIG: RollConfig = {
        cost: config.roll?.cost || 300,
        rewards: [
            {
                min: 100,
                max: 100,
                weight: 10,
                message: (amount: number) => `获得 ${amount} 星币，再试一次吧！`,
            },
            {
                min: 150,
                max: 150,
                weight: 15,
                message: (amount: number) => `获得 ${amount} 星币，差一点点就回本了！`,
            },
            {
                min: 200,
                max: 200,
                weight: 25,
                message: (amount: number) => `获得 ${amount} 星币，继续努力！`,
            },
            {
                min: 250,
                max: 250,
                weight: 15,
                message: (amount: number) => `获得 ${amount} 星币，接近回本了！`,
            },
            {
                min: 300,
                max: 300,
                weight: 15,
                message: (amount: number) => `恭喜获得 ${amount} 星币，刚好回本！`,
            },
            {
                min: 400,
                max: 400,
                weight: 10,
                message: (amount: number) => `恭喜获得 ${amount} 星币！小赚一笔！`,
            },
            {
                min: 600,
                max: 600,
                weight: 5,
                message: (amount: number) => `恭喜获得 ${amount} 星币！大赚特赚！欧皇附体！`,
            },
            {
                min: 800,
                max: 800,
                weight: 5,
                message: (amount: number) => `恭喜获得 ${amount} 星币！超级大赚！欧皇降临！`,
            },
        ],
    };

    // 计算平均返还星币数量
    // 100*10% + 150*15% + 200*25% + 250*20% + 300*15% + 400*10% + 600*5% = 237.5 星币

    /**
     * 获取用户今日抽奖次数
     */
    async function countUserRollsToday(
        ctx: Context,
        userId: string,
        channelId: string,
        date: string
    ): Promise<number> {
        const record = await ctx.database
            .select('rolls')
            .where({ userId, channelId, date })
            .execute()
            .then((records) => records[0]);
        return record?.count || 0;
    }

    /**
     * 保存抽奖记录 - 更新每日统计
     */
    async function saveRollRecord(
        ctx: Context,
        userId: string,
        channelId: string,
        date: string,
        cost: number,
        reward: number
    ): Promise<void> {
        // 先检查记录是否存在
        const existingRecord = await ctx.database
            .select('rolls')
            .where({ userId, channelId, date })
            .execute()
            .then((records) => records[0]);

        if (existingRecord) {
            // 如果记录存在，更新记录
            await ctx.database.set('rolls', existingRecord.id, {
                totalCost: existingRecord.totalCost + cost,
                totalReward: existingRecord.totalReward + reward,
                count: existingRecord.count + 1,
            });
        } else {
            // 如果记录不存在，创建新记录
            await ctx.database.create('rolls', {
                userId,
                channelId,
                date,
                totalCost: cost,
                totalReward: reward,
                count: 1,
            });
        }
    }

    /**
     * 根据权重随机选择奖励
     */
    function selectReward(rewards: RollConfig['rewards']): (typeof rewards)[0] {
        const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
        let random = randomFloat(0, totalWeight);

        for (const reward of rewards) {
            if (random < reward.weight) {
                return reward;
            }
            random -= reward.weight;
        }

        // 默认返回第一个奖励
        return rewards[0];
    }

    /**
     * 执行抽奖
     */
    async function doRoll(ctx: Context, session: Session, cost: number): Promise<string> {
        const { userId, channelId } = session;
        const today = getTodayString();
        const dailyLimit = config.roll?.dailyLimit || 1;

        // 检查今日抽奖次数是否已达上限
        const todayRolls = await countUserRollsToday(ctx, userId, channelId, today);
        if (todayRolls >= dailyLimit) {
            return `你今天已经抽奖${todayRolls}次了，已达到每日${dailyLimit}次的上限，请明天再来！`;
        }

        // 检查星币是否足够
        const currentStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);
        if (currentStarCoin < cost) {
            return `星币不足，抽奖需要 ${cost} 星币，你当前有 ${currentStarCoin} 星币！`;
        }

        // 显示剩余抽奖次数并请求确认
        const remainingRolls = dailyLimit - todayRolls;
        try {
            await session.send(
                `今日剩余抽奖次数：${remainingRolls}次\n确认花费 ${cost} 星币进行抽奖吗？请回复「确认」或「取消」（30秒内有效）`
            );
            const confirmed = await confirmationManager.createConfirmation(ctx, session, 30);

            if (!confirmed) {
                return '抽奖已取消！';
            }

            // 扣除星币
            const deductSuccess = await StarCoinHelper.removeUserStarCoin(
                ctx,
                userId,
                channelId,
                cost
            );
            if (!deductSuccess) {
                return '扣除星币失败，请稍后再试！';
            }

            // 随机选择奖励类型
            const rewardType = selectReward(DEFAULT_ROLL_CONFIG.rewards);
            // 生成随机奖励数量
            const rewardAmount = randomInt(
                rewardType.min,
                rewardType.max,
                `${userId}${channelId}${today}`
            );

            // 发放奖励
            const addSuccess = await StarCoinHelper.addUserStarCoin(
                ctx,
                userId,
                channelId,
                rewardAmount
            );
            if (!addSuccess) {
                return '发放奖励失败，请联系管理员！';
            }

            // 保存记录
            await saveRollRecord(ctx, userId, channelId, today, cost, rewardAmount);

            // 返回结果
            const resultMessage = rewardType.message(rewardAmount);
            const finalStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);
            // 显示剩余抽奖次数
            const remainingRollsAfter = dailyLimit - (todayRolls + 1);
            return `${resultMessage}\n当前星币余额：${finalStarCoin} 星币\n今日剩余抽奖次数：${remainingRollsAfter}次`;
        } catch (error) {
            ctx.logger.warn('抽奖过程中出现错误:', error);
            return '抽奖过程中出现错误，请稍后再试！';
        }
    }

    // 注册抽奖命令
    ctx.command('roll', '消耗星币进行抽奖，每天每群每人限抽一次').action(async ({ session }) => {
        if (!session) return '无法在当前环境中使用此命令';

        const cost = config.roll?.cost || 300;
        return doRoll(ctx, session, cost);
    });
}

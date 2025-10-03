import {Config} from '../../../index';
import {Context, Session} from 'koishi';
import {StarCoinHelper} from '../../../utils/starcoin_helper';
import {useConfirmationHelper} from '../../../utils/confirmation_helper';
import {randomFloat, randomInt} from '../../../utils/pseudo_random_helper';
import {getTodayString} from '../../../utils/time_helper';

// 定义抽奖记录表结构
interface RollRecord {
    id: number;
    userId: string;
    channelId: string;
    date: string;
    cost: number;
    reward: number;
    rollTime: number;
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
    // 确保数据表存在
    ctx.database.extend('rolls', {
        id: 'unsigned',
        userId: 'string',
        channelId: 'string',
        date: 'string',
        cost: 'unsigned',
        reward: 'unsigned',
        rollTime: 'unsigned',
    }, {
        primary: 'id',
        autoInc: true,
        unique: [['userId', 'channelId', 'date']]
    });

    // 初始化确认管理器
    const confirmationManager = useConfirmationHelper(ctx);

    // 默认抽奖配置
  const DEFAULT_ROLL_CONFIG: RollConfig = {
    cost: config.roll?.cost || 300,
    rewards: [
      { min: 100, max: 100, weight: 10, message: (amount: number) => `恭喜获得 ${amount} 星币！再接再厉！` },
      { min: 150, max: 150, weight: 15, message: (amount: number) => `恭喜获得 ${amount} 星币！小有收获！` },
      { min: 200, max: 200, weight: 25, message: (amount: number) => `恭喜获得 ${amount} 星币！不错的收获！` },
      { min: 250, max: 250, weight: 15, message: (amount: number) => `恭喜获得 ${amount} 星币！手气不错！` },
      { min: 300, max: 300, weight: 15, message: (amount: number) => `恭喜获得 ${amount} 星币！运气很好！` },
      { min: 400, max: 400, weight: 10, message: (amount: number) => `恭喜获得 ${amount} 星币！欧气爆发！` },
      { min: 600, max: 600, weight: 5, message: (amount: number) => `恭喜获得 ${amount} 星币！超级欧皇！` },
      { min: 800, max: 800, weight: 5, message: (amount: number) => `恭喜获得 ${amount} 星币！欧气冲天！` },
    ]
  };

  // 计算平均返还星币数量
  // 100*10% + 150*15% + 200*25% + 250*20% + 300*15% + 400*10% + 600*5% = 237.5 星币

    /**
     * 检查用户今日是否已抽奖
     */
    async function hasUserRolledToday(ctx: Context, userId: string, channelId: string, date: string): Promise<boolean> {
        const records = await ctx.database
            .select('rolls')
            .where({userId, channelId, date})
            .execute();
        return records.length > 0;
    }

    /**
     * 保存抽奖记录
     */
    async function saveRollRecord(ctx: Context, userId: string, channelId: string, date: string, cost: number, reward: number): Promise<void> {
        await ctx.database.create('rolls', {
            userId,
            channelId,
            date,
            cost,
            reward,
            rollTime: Date.now()
        });
    }

    /**
     * 根据权重随机选择奖励
     */
    function selectReward(rewards: RollConfig['rewards']): typeof rewards[0] {
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
        const {userId, channelId} = session;
        const today = getTodayString();

        // 检查今日是否已抽奖
        if (await hasUserRolledToday(ctx, userId, channelId, today)) {
            return '你今天已经抽过奖了，请明天再来！';
        }

        // 检查星币是否足够
        const currentStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);
        if (currentStarCoin < cost) {
            return `星币不足，抽奖需要 ${cost} 星币，你当前有 ${currentStarCoin} 星币！`;
        }

        try {
            // 请求确认
            await session.send(`确认花费 ${cost} 星币进行抽奖吗？请回复「确认」或「取消」（30秒内有效）`);
            const confirmed = await confirmationManager.createConfirmation(ctx, session, 30);

            if (!confirmed) {
                return '抽奖已取消！';
            }

            // 扣除星币
            const deductSuccess = await StarCoinHelper.removeUserStarCoin(ctx, userId, channelId, cost);
            if (!deductSuccess) {
                return '扣除星币失败，请稍后再试！';
            }

            // 随机选择奖励类型
            const rewardType = selectReward(DEFAULT_ROLL_CONFIG.rewards);
            // 生成随机奖励数量
            const rewardAmount = randomInt(rewardType.min, rewardType.max, `${userId}${channelId}${today}`);

            // 发放奖励
            const addSuccess = await StarCoinHelper.addUserStarCoin(ctx, userId, channelId, rewardAmount);
            if (!addSuccess) {
                return '发放奖励失败，请联系管理员！';
            }

            // 保存记录
            await saveRollRecord(ctx, userId, channelId, today, cost, rewardAmount);

            // 返回结果
            const resultMessage = rewardType.message(rewardAmount);
            const finalStarCoin = await StarCoinHelper.getUserStarCoin(ctx, userId, channelId);
            return `${resultMessage}\n当前星币余额：${finalStarCoin} 星币`;

        } catch (error) {
            ctx.logger.warn('抽奖过程中出现错误:', error);
            return '抽奖过程中出现错误，请稍后再试！';
        }
    }

    // 注册抽奖命令
    ctx.command('roll', '消耗星币进行抽奖，每天每群每人限抽一次')
        .action(async ({session}) => {
            if (!session) return '无法在当前环境中使用此命令';

            const cost = config.roll?.cost || 300;
            return doRoll(ctx, session, cost);
        });
}
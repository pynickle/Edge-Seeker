import { Context, Session } from 'koishi';
import { StarCoinHelper } from '../../../../utils/starcoin_helper';
import { ITEMS } from '../item_mapping';

// 商店会话状态接口
interface MarketSession {
    userId: string;
    channelId: string;
    username: string;
    timer: NodeJS.Timeout;
}

class MarketPlugin {
    // 存储当前打开的商店会话
    private activeSessions = new Map<string, MarketSession>();

    constructor(private ctx: Context) {
        this.registerCommands();
        this.setupMessageListener();
    }

    private registerCommands(): void {
        // 打开商店命令
        this.ctx
            .command('market', '打开商店购买道具')
            .action(async ({ session }) => this.handleMarketCommand(session));
    }

    private setupMessageListener(): void {
        // 监听消息，处理商店内的购买请求
        this.ctx.middleware(async (session, next) => {
            const { userId, channelId } = session;
            const sessionKey = `${channelId}:${userId}`;

            // 检查用户是否有活跃的商店会话
            if (this.activeSessions.has(sessionKey)) {
                const content = session.content.trim();

                // 处理退出商店
                if (
                    content === '退出' ||
                    content === 'quit' ||
                    content === 'exit'
                ) {
                    this.closeMarketSession(sessionKey);
                    await session.send(`🛒 已退出商店。`);
                    return;
                }

                // 处理购买请求
                const itemIndex = parseInt(content) - 1;
                if (
                    !isNaN(itemIndex) &&
                    itemIndex >= 0 &&
                    itemIndex < ITEMS.length
                ) {
                    await this.handlePurchase(session, itemIndex);
                    return;
                }

                // 非购买或退出命令，提示用户
                await session.send(
                    `@${session.username}，请输入道具编号购买或输入"退出"关闭商店。`
                );
                return;
            }

            return next();
        }, true);
    }

    private async handleMarketCommand(session: Session): Promise<string> {
        const { userId, channelId, username } = session;
        const sessionKey = `${channelId}:${userId}`;

        // 检查用户是否已有活跃的商店会话
        if (this.activeSessions.has(sessionKey)) {
            return `@${username}，您已经打开了商店，请先完成当前操作或输入"退出"关闭商店。`;
        }

        // 获取用户星币数量
        const starCoins = await this.getUserStarCoins(userId, channelId);

        // 创建商店会话
        const timer = setTimeout(() => {
            this.closeMarketSession(sessionKey);
            session.send(`@${username}，商店已自动关闭。`);
        }, 30000); // 30 秒后自动关闭

        this.activeSessions.set(sessionKey, {
            userId,
            channelId,
            username,
            timer,
        });

        // 生成商店消息
        const marketMessage = [
            `🛒 @${username} 的个人商店已开启！`,
            `💎 当前星币：${starCoins}`,
            `⏰ 商店将在30秒后自动关闭，输入"退出"可立即关闭。`,
            `📋 请输入道具编号进行购买：`,
        ];

        // 按道具类型分组
        const itemsByType: Record<
            string,
            Array<{ index: number; item: (typeof ITEMS)[0] }>
        > = {
            buff: [],
            other: [],
            consumable: [],
        };

        // 将道具按类型分组
        ITEMS.forEach((item, index) => {
            if (itemsByType[item.type]) {
                itemsByType[item.type].push({ index: index + 1, item });
            }
        });

        // 类型名称映射
        const typeNames: Record<string, string> = {
            buff: '✨ 增益道具',
            consumable: '🎯 消耗道具',
            other: '🔮 其他道具',
        };

        // 按类型添加道具到消息中
        ['buff', 'consumable', 'other'].forEach((type) => {
            const items = itemsByType[type];
            if (items && items.length > 0) {
                marketMessage.push(`\n${typeNames[type]}：`);
                items.forEach(({ index, item }) => {
                    marketMessage.push(
                        `${index}. ${item.name} - ${item.price}星币`
                    );
                    marketMessage.push(`   ${item.description}`);
                });
            }
        });

        return marketMessage.join('\n');
    }
    private async handlePurchase(
        session: Session,
        itemIndex: number
    ): Promise<void> {
        const { userId, channelId, username } = session;
        const sessionKey = `${channelId}:${userId}`;
        const item = ITEMS[itemIndex];

        // 检查用户星币是否足够
        const hasEnough = await StarCoinHelper.hasEnoughStarCoin(
            this.ctx,
            userId,
            channelId,
            item.price
        );
        if (!hasEnough) {
            const currentStarCoin = await StarCoinHelper.getUserStarCoin(
                this.ctx,
                userId,
                channelId
            );
            await session.send(
                `@${username}，星币不足，无法购买 ${item.name}！当前星币: ${currentStarCoin}，需要: ${item.price}`
            );
            return;
        }

        // 扣除星币
        const success = await StarCoinHelper.removeUserStarCoin(
            this.ctx,
            userId,
            channelId,
            item.price
        );

        if (!success) {
            await session.send(`@${username}，星币扣除失败，请稍后再试！`);
            return;
        }

        // 添加道具到用户道具库
        const existingItem = await this.ctx.database
            .select('market_user_items')
            .where({ userId, channelId, itemId: item.id })
            .execute();

        if (existingItem.length > 0) {
            // 增加现有道具数量
            await this.ctx.database.set(
                'market_user_items',
                { userId, channelId, itemId: item.id },
                { quantity: existingItem[0].quantity + 1 }
            );
        } else {
            // 创建新道具记录
            await this.ctx.database.create('market_user_items', {
                userId,
                channelId,
                itemId: item.id,
                quantity: 1,
            });
        }

        await session.send(`💸 @${username} 成功购买了 ${item.name}！`);

        // 关闭商店会话
        this.closeMarketSession(sessionKey);
    }

    private closeMarketSession(sessionKey: string): void {
        const session = this.activeSessions.get(sessionKey);
        if (session) {
            clearTimeout(session.timer);
            this.activeSessions.delete(sessionKey);
        }
    }

    private async getUserStarCoins(
        userId: string,
        channelId: string
    ): Promise<number> {
        return await StarCoinHelper.getUserStarCoin(
            this.ctx,
            userId,
            channelId
        );
    }
}

export default MarketPlugin;

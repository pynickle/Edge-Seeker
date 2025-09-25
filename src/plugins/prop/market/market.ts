import { Context, Session } from 'koishi';
import {ITEMS} from "../item_mapping";

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
        this.ctx.command('market', '打开商店购买道具')
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
                if (content === '退出' || content === 'quit' || content === 'exit') {
                    this.closeMarketSession(sessionKey);
                    await session.send(`🛒 已退出商店。`);
                    return;
                }

                // 处理购买请求
                const itemIndex = parseInt(content) - 1;
                if (!isNaN(itemIndex) && itemIndex >= 0 && itemIndex < ITEMS.length) {
                    await this.handlePurchase(session, itemIndex);
                    return;
                }

                // 非购买或退出命令，提示用户
                await session.send(`@${session.username}，请输入道具编号购买或输入"退出"关闭商店。`);
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
            session.send(`@${username}，商店已自动关闭。`).catch(console.error);
        }, 30000); // 30秒后自动关闭

        this.activeSessions.set(sessionKey, {
            userId,
            channelId,
            username,
            timer
        });

        // 生成商店消息
        const marketMessage = [
            `🛒 @${username} 的个人商店已开启！`,
            `💎 当前星币：${starCoins}`,
            `⏰ 商店将在30秒后自动关闭，输入"退出"可立即关闭。`,
            `📋 请输入道具编号进行购买：`
        ];

        // 添加道具列表
        ITEMS.forEach((item, index) => {
            marketMessage.push(`${index + 1}. ${item.name} - ${item.price}星币`);
            marketMessage.push(`   ${item.description}`);
        });

        return marketMessage.join('\n');
    }
    private async handlePurchase(session: Session, itemIndex: number): Promise<void> {
        const { userId, channelId, username } = session;
        const sessionKey = `${channelId}:${userId}`;
        const item = ITEMS[itemIndex];

        // 获取用户星币数量
        const userRecord = await this.ctx.database.select('sign_in')
            .where({ userId, channelId })
            .execute();

        if (userRecord.length === 0 || userRecord[0].starCoin < item.price) {
            await session.send(`@${username}，星币不足，无法购买 ${item.name}！`);
            return;
        }

        // 扣除星币
        await this.ctx.database.set('sign_in',
            { userId, channelId },
            { starCoin: userRecord[0].starCoin - item.price }
        );

        // 添加道具到用户道具库
        const existingItem = await this.ctx.database.select('market_user_items')
            .where({ userId, channelId, itemId: item.id })
            .execute();

        if (existingItem.length > 0) {
            // 增加现有道具数量
            await this.ctx.database.set('market_user_items',
                { userId, channelId, itemId: item.id },
                { quantity: existingItem[0].quantity + 1 }
            );
        } else {
            // 创建新道具记录
            await this.ctx.database.create('market_user_items', {
                userId,
                channelId,
                itemId: item.id,
                quantity: 1
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

    private async getUserStarCoins(userId: string, channelId: string): Promise<number> {
        const userRecord = await this.ctx.database.select('sign_in')
            .where({ userId, channelId })
            .execute();

        return userRecord.length > 0 ? userRecord[0].starCoin : 0;
    }
}

export default MarketPlugin;
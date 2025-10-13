import { Context } from 'koishi';
import { Config } from '../../../index';
import { getUserName } from '../../../utils/onebot_helper';
import { StarCoinHelper } from '../../../utils/starcoin_helper';

export interface UserMarketItem {
    id: number; // 自增主键
    userId: string; // 上传者用户ID
    content: string; // 上架的消息内容
    price: number; // 价格（星币）
    createTime: string; // 创建时间
}

export interface UserMarketItemInGroup {
    id: number; // 自增主键
    itemId: number; // 关联的商品ID
    channelId: string; // 群聊ID
    createTime: string; // 添加到群聊的时间
}

declare module 'koishi' {
    interface Tables {
        user_market_items: UserMarketItem;
        user_market_items_in_group: UserMarketItemInGroup;
    }
}

class UserMarketPlugin {
    constructor(
        private ctx: Context,
        private config: Config
    ) {
        this.setupDatabase();
        this.registerCommands();
    }

    private setupDatabase(): void {
        // 设置商品表
        this.ctx.model.extend(
            'user_market_items',
            {
                id: 'unsigned',
                userId: 'string',
                content: 'string',
                price: 'integer',
                createTime: 'string',
            },
            {
                primary: 'id',
                autoInc: true,
            }
        );

        // 设置商品-群聊关联表
        this.ctx.model.extend(
            'user_market_items_in_group',
            {
                id: 'unsigned',
                itemId: 'unsigned',
                channelId: 'string',
                createTime: 'string',
            },
            {
                primary: 'id',
                autoInc: true,
                unique: [['itemId', 'channelId']], // 确保一个商品在一个群聊中只能存在一次
            }
        );
    }

    private registerCommands(): void {
        // 私聊指令：上架商品
        this.ctx
            .command(
                'market.sell <price:number>',
                '上架一条消息到商城（仅私聊）',
                { authority: 1 }
            )
            .action(async ({ session }, price) => {
                // 只允许在私聊中使用
                if (session.guildId) {
                    return '该命令只能在私聊中使用！';
                }

                // 验证价格
                if (price <= 0 || !Number.isInteger(price)) {
                    return '请输入有效的正整数价格！';
                }

                // 确保用户引用了一条消息
                if (!session.quote) {
                    return '请引用一条消息后再使用此命令！';
                }

                const { userId } = session;
                const content = session.quote.content;
                const createTime = new Date().toISOString();

                try {
                    // 创建商品记录
                    const result = await this.ctx.database.create(
                        'user_market_items',
                        {
                            userId,
                            content,
                            price,
                            createTime,
                        }
                    );

                    return `✅ 商品上架成功！\n商品ID：${result.id}\n价格：${price} 星币\n请前往你想要上架该商品的群聊，使用 market.add ${result.id} 命令将商品添加到群聊商城。`;
                } catch (error) {
                    this.ctx.logger.warn('上架商品失败:', error);
                    return '❌ 上架商品失败，请稍后重试！';
                }
            });

        // 私聊指令：彻底删除商品
        this.ctx
            .command(
                'market.delete <itemId:number>',
                '彻底删除你上架的商品（仅私聊）',
                { authority: 1 }
            )
            .action(async ({ session }, itemId) => {
                // 只允许在私聊中使用
                if (session.guildId) {
                    return '该命令只能在私聊中使用！';
                }

                const { userId } = session;

                try {
                    // 检查商品是否存在且属于该用户
                    const items = await this.ctx.database
                        .select('user_market_items')
                        .where({ id: itemId, userId })
                        .execute();

                    if (items.length === 0) {
                        return '❌ 未找到该商品或你没有权限删除该商品！';
                    }

                    // 删除商品-群聊关联
                    await this.ctx.database.remove(
                        'user_market_items_in_group',
                        { itemId }
                    );

                    // 删除商品
                    await this.ctx.database.remove('user_market_items', {
                        id: itemId,
                    });

                    return `✅ 商品ID ${itemId} 已彻底删除！`;
                } catch (error) {
                    this.ctx.logger.warn('删除商品失败:', error);
                    return '❌ 删除商品失败，请稍后重试！';
                }
            });

        // 群聊指令：查看当前群聊的商城内容
        this.ctx
            .command('market.list', '查看当前群聊的商城内容', { authority: 1 })
            .action(async ({ session }) => {
                // 只允许在群聊中使用
                if (!session.guildId) {
                    return '该命令只能在群聊中使用！';
                }

                const { channelId } = session;

                try {
                    // 查询当前群聊的商品
                    const itemsInGroup = await this.ctx.database
                        .select('user_market_items_in_group')
                        .where({ channelId })
                        .execute();

                    if (itemsInGroup.length === 0) {
                        return '当前群聊商城暂无商品！';
                    }

                    // 获取商品详情
                    const itemIds = itemsInGroup.map((item) => item.itemId);
                    const items = await this.ctx.database
                        .select('user_market_items')
                        .where({ id: { $in: itemIds } })
                        .execute();

                    // 生成商品列表
                    const itemList = await Promise.all(
                        items.map(async (item, index) => {
                            const sellerName = await getUserName(
                                this.ctx,
                                session,
                                item.userId
                            );
                            return `${index + 1}. 商品ID: ${item.id}\n   卖家: ${sellerName}\n   价格: ${item.price} 星币\n   上架时间: ${item.createTime.split('T')[0]}`;
                        })
                    );

                    return `🛒 当前群聊商城商品列表：\n\n${itemList.join('\n\n')}\n\n使用 market.buy <商品ID> 购买商品！`;
                } catch (error) {
                    this.ctx.logger.warn('获取商品列表失败:', error);
                    return '❌ 获取商品列表失败，请稍后重试！';
                }
            });

        // 群聊指令：添加商品到当前群聊
        this.ctx
            .command(
                'market.add <itemId:number>',
                '将你上架的商品添加到当前群聊（仅上传者和管理员可用）',
                { authority: 1 }
            )
            .action(async ({ session }, itemId) => {
                // 只允许在群聊中使用
                if (!session.guildId) {
                    return '该命令只能在群聊中使用！';
                }

                const { userId, channelId } = session;

                try {
                    // 检查商品是否存在
                    const items = await this.ctx.database
                        .select('user_market_items')
                        .where({ id: itemId })
                        .execute();

                    if (items.length === 0) {
                        return '❌ 未找到该商品！';
                    }

                    const item = items[0];

                    // 检查用户权限（上传者或authority>3）
                    const user = await this.ctx.database.getUser(
                        session.platform,
                        session.userId
                    );
                    const userAuthority = user.authority;
                    if (item.userId !== userId && userAuthority <= 3) {
                        return '❌ 你没有权限添加该商品到本群！';
                    }

                    // 检查商品是否已经添加到该群聊
                    const existing = await this.ctx.database
                        .select('user_market_items_in_group')
                        .where({ itemId, channelId })
                        .execute();

                    if (existing.length > 0) {
                        return '❌ 该商品已经在本群商城中了！';
                    }

                    // 添加商品到群聊
                    await this.ctx.database.create(
                        'user_market_items_in_group',
                        {
                            itemId,
                            channelId,
                            createTime: new Date().toISOString(),
                        }
                    );

                    return `✅ 商品ID ${itemId} 已成功添加到本群商城！`;
                } catch (error) {
                    this.ctx.logger.warn('添加商品到群聊失败:', error);
                    return '❌ 添加商品到群聊失败，请稍后重试！';
                }
            });

        // 群聊指令：从当前群聊移除商品
        this.ctx
            .command(
                'market.remove <itemId:number>',
                '从当前群聊移除商品（仅上传者和管理员可用）',
                { authority: 1 }
            )
            .action(async ({ session }, itemId) => {
                // 只允许在群聊中使用
                if (!session.guildId) {
                    return '该命令只能在群聊中使用！';
                }

                const { userId, channelId } = session;

                try {
                    // 检查商品是否存在
                    const items = await this.ctx.database
                        .select('user_market_items')
                        .where({ id: itemId })
                        .execute();

                    if (items.length === 0) {
                        return '❌ 未找到该商品！';
                    }

                    const item = items[0];

                    // 检查用户权限（上传者或authority>3）
                    const user = await this.ctx.database.getUser(
                        session.platform,
                        session.userId
                    );
                    const userAuthority = user.authority;
                    if (item.userId !== userId && userAuthority <= 3) {
                        return '❌ 你没有权限从本群移除该商品！';
                    }

                    // 检查商品是否在该群聊中
                    const existing = await this.ctx.database
                        .select('user_market_items_in_group')
                        .where({ itemId, channelId })
                        .execute();

                    if (existing.length === 0) {
                        return '❌ 该商品不在本群商城中！';
                    }

                    // 从群聊中移除商品
                    await this.ctx.database.remove(
                        'user_market_items_in_group',
                        { itemId, channelId }
                    );

                    return `✅ 商品ID ${itemId} 已从本群商城移除！`;
                } catch (error) {
                    this.ctx.logger.warn('从群聊移除商品失败:', error);
                    return '❌ 从群聊移除商品失败，请稍后重试！';
                }
            });

        // 群聊指令：购买商品
        this.ctx
            .command('market.buy <itemId:number>', '购买当前群聊商城中的商品', {
                authority: 1,
            })
            .action(async ({ session }, itemId) => {
                // 只允许在群聊中使用
                if (!session.guildId) {
                    return '该命令只能在群聊中使用！';
                }

                const { userId, channelId } = session;

                try {
                    // 检查商品是否在该群聊中
                    const itemsInGroup = await this.ctx.database
                        .select('user_market_items_in_group')
                        .where({ itemId, channelId })
                        .execute();

                    if (itemsInGroup.length === 0) {
                        return '❌ 该商品不在本群商城中！';
                    }

                    // 获取商品详情
                    const items = await this.ctx.database
                        .select('user_market_items')
                        .where({ id: itemId })
                        .execute();

                    if (items.length === 0) {
                        return '❌ 该商品已被删除！';
                    }

                    const item = items[0];

                    // 检查是否是自己的商品
                    if (item.userId === userId) {
                        return '❌ 不能购买自己的商品！';
                    }

                    // 检查用户星币是否足够
                    const hasEnough = await StarCoinHelper.hasEnoughStarCoin(
                        this.ctx,
                        userId,
                        channelId,
                        item.price
                    );
                    if (!hasEnough) {
                        const currentStarCoin =
                            await StarCoinHelper.getUserStarCoin(
                                this.ctx,
                                userId,
                                channelId
                            );
                        return `❌ 你的星币不足！当前星币：${currentStarCoin}，需要：${item.price}`;
                    }

                    // 计算手续费和实际支付金额
                    const fee = Math.max(1, Math.floor(item.price * 0.2)); // 20%手续费，至少1星币
                    const actualAmount = item.price - fee;

                    // 检查是否为好友关系
                    let isFriend = false;
                    if (session.onebot) {
                        try {
                            const friendList =
                                await session.onebot.getFriendList();
                            isFriend = friendList.some(
                                (friend) => friend.user_id.toString() == userId
                            );
                        } catch (error) {
                            this.ctx.logger.warn('获取好友列表失败:', error);
                        }
                    }

                    if (!isFriend) {
                        return '❌ 你还不是该卖家的好友，请先使用 friend 指令添加好友！';
                    }

                    // 扣除买家星币
                    const success = await StarCoinHelper.removeUserStarCoin(
                        this.ctx,
                        userId,
                        channelId,
                        item.price
                    );
                    if (!success) {
                        return '❌ 购买失败，请稍后重试！';
                    }

                    // 增加卖家星币
                    await StarCoinHelper.addUserStarCoin(
                        this.ctx,
                        item.userId,
                        channelId,
                        actualAmount
                    );

                    // 发送商品内容给买家
                    if (session.onebot) {
                        try {
                            await session.onebot.sendPrivateMsg(
                                userId,
                                `🎉 你成功购买了商品ID ${itemId}！\n支付：${item.price} 星币\n手续费：${fee} 星币\n实际支付给卖家：${actualAmount} 星币\n商品内容：`
                            );
                            await session.onebot.sendPrivateMsg(
                                userId,
                                item.content
                            );
                        } catch (error) {
                            this.ctx.logger.warn(
                                '发送商品内容给买家失败:',
                                error
                            );
                        }
                    }

                    // 获取卖家名称
                    const sellerName = await getUserName(
                        this.ctx,
                        session,
                        item.userId
                    );
                    const buyerName = await getUserName(
                        this.ctx,
                        session,
                        userId
                    );

                    return `✅ ${buyerName} 成功购买了 ${sellerName} 的商品ID ${itemId}！\n商品内容已通过私信发送给你。`;
                } catch (error) {
                    this.ctx.logger.warn('购买商品失败:', error);
                    return '❌ 购买商品失败，请稍后重试！';
                }
            });
    }
}

export default UserMarketPlugin;

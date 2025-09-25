import {Context, Session} from 'koishi';
import {Config} from '../../../index';
import {ITEMS} from "../item_mapping";
import {useBuffItem} from "../prop_helper";

// 定义用户道具接口
export interface UserItem {
    id: number; // 自增主键
    userId: string;
    channelId: string;
    itemId: string;
    quantity: number;
    expireDate?: number; // 过期时间戳，可选
}

// 定义Buff类型枚举
export enum BuffType {
    LUCKY_CARD = 'lucky_card',
    // 可以添加更多类型的buff
}

// 定义通用Buff效果接口
export interface BuffEffect {
    id: number; // 自增主键
    userId: string;
    buffType: BuffType;
    startDate: string; // YYYY-MM-DD 格式
    endDate: string; // YYYY-MM-DD 格式
    data?: Record<string, any>; // 存储特定buff需要的额外数据
}

declare module 'koishi' {
    interface Tables {
        market_user_items: UserItem;
        user_buff_effects: BuffEffect;
    }
}

class InventoryPlugin {
    private ctx: Context;

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.setupDatabase();
        this.registerCommands();
    }

    private setupDatabase(): void {
        // 用户道具表
        this.ctx.model.extend('market_user_items', {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            itemId: 'string',
            quantity: 'integer',
            expireDate: 'unsigned',
        }, {
            primary: 'id',
            autoInc: true,
            indexes: [
                ['userId', 'channelId', 'itemId']
            ]
        });

        // 通用Buff效果表
        this.ctx.model.extend('user_buff_effects', {
            id: 'unsigned',
            userId: 'string',
            buffType: 'string',
            startDate: 'string',
            endDate: 'string',
            data: 'json' // JSON格式存储额外数据
        }, {
            primary: 'id',
            autoInc: true,
            indexes: [
                ['userId', 'buffType', 'startDate', 'endDate']
            ]
        });
    }

    private registerCommands(): void {
        // 查看道具库命令
        this.ctx.command('inventory', '查看你的道具库')
            .action(async ({session}) => this.handleInventoryCommand(session));

        // 使用道具命令
        this.ctx.command('use <itemName:string>', '使用道具')
            .action(async ({session}, itemName: string) => this.handleUseItemCommand(session, itemName));
    }

    private async handleInventoryCommand(session: Session): Promise<string> {
        const {userId, channelId, username} = session;

        // 查询用户的道具
        const userItems = await this.ctx.database.select('market_user_items')
            .where({userId, channelId})
            .execute();

        if (userItems.length === 0) {
            return `@${username}，您的道具库是空的。去商店购买一些道具吧！`;
        }

        // 获取道具列表
        const items = [...ITEMS];

        // 生成道具库消息
        const inventoryMessage = [
            `🎒 @${username} 的道具库：`
        ];

        userItems.forEach(item => {
            const itemInfo = items.find(i => i.id === item.itemId);
            if (itemInfo) {
                const expireInfo = item.expireDate ?
                    `（有效期至：${new Date(item.expireDate).toLocaleDateString()}）` :
                    '';
                inventoryMessage.push(`${itemInfo.name} x${item.quantity} ${expireInfo}`);
            }
        });

        inventoryMessage.push('\n输入 "use 道具名" 使用道具，例如 "use 幸运卡"');

        return inventoryMessage.join('\n');
    }

    private async handleUseItemCommand(session: Session, itemName: string): Promise<string> {
        const {userId, channelId, username} = session;

        // 获取道具列表
        const items = [...ITEMS];

        // 查找对应的道具
        const item = items.find(i => i.name.includes(itemName) || itemName.includes(i.name));

        if (!item) {
            return `@${username}，找不到名为 "${itemName}" 的道具。`;
        }

        // 检查用户是否拥有该道具
        const userItem = await this.ctx.database.select('market_user_items')
            .where({userId, channelId, itemId: item.id})
            .execute();

        if (userItem.length === 0 || userItem[0].quantity <= 0) {
            return `@${username}，您没有 "${item.name}" 道具。`;
        }

        // 处理道具使用逻辑
        if (item.type === 'buff' && item.buffConfig) {
            return await useBuffItem(session, this.ctx, item);
        }

        return `@${username}，道具 "${item.name}" 的使用功能还未实现。`;
    }
}

export default InventoryPlugin;
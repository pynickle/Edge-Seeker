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

        // 按类型分组道具
        const buffItems: string[] = [];
        const otherItems: string[] = [];

        userItems.forEach(item => {
            const itemInfo = items.find(i => i.id === item.itemId);
            if (itemInfo) {
                const expireInfo = item.expireDate ?
                    `（有效期至：${new Date(item.expireDate).toLocaleDateString()}）` :
                    '';
                let itemLine = `${itemInfo.name} x${item.quantity} ${expireInfo}`;
                
                // 如果是other类型且有使用说明，添加使用说明标记
                if (itemInfo.type === 'other' && itemInfo.usageInstructions) {
                    itemLine += ' 💡';
                }
                
                // 根据道具类型分组
                if (itemInfo.type === 'buff') {
                    buffItems.push(itemLine);
                } else {
                    otherItems.push(itemLine);
                }
            }
        });

        // 生成道具库消息
        const inventoryMessage = [
            `🎒 @${username} 的道具库：`
        ];

        // 添加buff类型道具
        if (buffItems.length > 0) {
            inventoryMessage.push('\n✨ 增益道具：');
            inventoryMessage.push(...buffItems);
        }

        // 添加其他类型道具
        if (otherItems.length > 0) {
            inventoryMessage.push('\n📦 其他道具：');
            inventoryMessage.push(...otherItems);
            
            // 查找是否有带使用说明的道具
            const hasInstructions = userItems.some(item => {
                const itemInfo = items.find(i => i.id === item.itemId);
                return itemInfo && itemInfo.type === 'other' && itemInfo.usageInstructions;
            });
            
            if (hasInstructions) {
                inventoryMessage.push('\n💡 标有💡的道具需使用特定命令，输入 "use 道具名" 查看具体使用方法');
            }
        }

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

        // 为other类型的道具提供更人性化的提示
        if (item.type === 'other') {
            if (item.usageInstructions) {
                return `@${username}，"${item.name}" 不能通过use命令直接使用。\n${item.usageInstructions}`;
            }
            
            return `@${username}，"${item.name}" 道具不能通过use命令直接使用。\n请查看道具描述了解如何使用。`;
        }

        return `@${username}，道具 "${item.name}" 的使用功能还未实现。`;
    }
}

export default InventoryPlugin;
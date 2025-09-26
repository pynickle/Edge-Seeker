// 定义道具接口
import {BuffType} from "./inventory/inventory";

export interface Item {
    id: string;
    name: string;
    description: string;
    price: number;
    type: 'consumable' | 'buff' | 'other';
    effect?: string;
    usageInstructions?: string; // 使用说明，适用于需要特定命令使用的道具
    // 以下为buff类型道具的配置参数
    buffConfig?: {
        durationDays: number; // 持续天数
        maxDurationDays: number; // 最大叠加天数
        buffType: BuffType; // 对应的BuffType
    };
}

// 道具列表
export const ITEMS: Item[] = [
    {
        id: 'lucky_card',
        name: '幸运卡',
        description: '使用后在未来3天（包括当天）略微提高今日运势',
        price: 30,
        type: 'buff',
        effect: '运势提升',
        buffConfig: {
            durationDays: 3, // 持续3天
            maxDurationDays: 10, // 最大叠加30天
            buffType: 'lucky_card' as BuffType
        }
    },
    {
        id: 'foresee_crystal',
        name: '预知水晶',
        description: '可以查看明日运势和明日人品',
        price: 10,
        type: 'other',
        effect: '预知明日',
        usageInstructions: '请使用 "mrrp" 命令查看明日人品，或使用 "mrys" 命令查看明日运势。\n（使用时将自动消耗一个预知水晶）'
    }
];
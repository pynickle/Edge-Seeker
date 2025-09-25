// 定义道具接口
import {BuffType} from "./inventory/inventory";

export interface Item {
    id: string;
    name: string;
    description: string;
    price: number;
    type: 'consumable' | 'buff' | 'other';
    effect?: string;
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
    }
];
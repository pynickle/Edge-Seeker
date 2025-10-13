import { Context } from 'koishi';
import { randomChoice } from '../../../utils/pseudo_random_helper';

export const name = 'choose';

// 响应模板配置
const RESPONSE_TEMPLATES = {
    choose: [
        '经过慎重考虑，我选择：{result}',
        '让我来看看... 嗯，选{result}吧！',
        '我觉得{result}是个不错的选择~',
        '随机挑选的结果是：{result}',
        '经过宇宙随机算法计算，最终结果是：{result}',
        '叮！你的随机结果是：{result}',
        '✨ 答案揭晓：{result} ✨',
    ],

    error: [
        '至少需要提供两个选项哦~',
        '你得给我至少两个选项才能帮你选呀！',
        '请输入至少两个选项，用空格分隔~',
    ],

    coin: [
        '硬币落地！是{result}！',
        '叮铃铃~ 硬币显示：{result}',
        '抛硬币结果：{result}',
        '硬币翻转... {result}朝上！',
    ],
} as const;

const COIN_SIDES = ['正面', '反面'] as const;

/**
 * 格式化响应消息
 */
function formatResponse(template: string, result: string): string {
    return template.replace('{result}', result);
}

/**
 * 生成随机选择响应
 */
function generateChooseResponse(result: string): string {
    const template = randomChoice<string>(RESPONSE_TEMPLATES.choose);
    return formatResponse(template, result);
}

/**
 * 生成掷硬币响应
 */
function generateCoinResponse(): string {
    const result = randomChoice(COIN_SIDES);
    const template = randomChoice(RESPONSE_TEMPLATES.coin);
    return formatResponse(template, result);
}

/**
 * 验证并过滤选项
 */
function validateOptions(options: string[]): string[] {
    return options
        .filter((option) => option.trim())
        .map((option) => option.trim());
}

export function choose(ctx: Context) {
    ctx.command('choose <...options:string>', '从多个选项中随机选择一个')
        .usage(
            '用法：choose 选项1 选项2 选项3 ...\n示例：choose 吃饭 睡觉 打游戏'
        )
        .action(async (_, ...options: string[]) => {
            if (options.some((option) => option.includes('茉莉'))) {
                return '选项中包含不当内容，请重新输入。';
            }
            const validOptions = validateOptions(options);

            if (validOptions.length < 2) {
                return randomChoice(RESPONSE_TEMPLATES.error);
            }

            const selectedOption = randomChoice(validOptions);
            return generateChooseResponse(selectedOption);
        });

    ctx.command('coin', '掷硬币决定').action(() => generateCoinResponse());
}

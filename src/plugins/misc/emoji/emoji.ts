import { Context } from 'koishi';
import * as emoji from 'node-emoji';

export const name = 'emoticon';

export function emoji_gen(ctx: Context) {
    ctx.command(
        'emoji [keyword:string]',
        '根据关键词查询对应 Emoji 或随机返回一个 Emoji'
    ).action(async ({}, keyword: string) => {
        if (!keyword) {
            return emoji.random().emoji;
        }
        const prompts = [
            `🎈 找到这些 "${keyword}" 表情：`,
            `😺 看看这些 "${keyword}" 表情！`,
            `✨ "${keyword}" 表情来袭：`,
            `🎉 发现 "${keyword}" 表情啦：`,
        ];
        const randomPrompt =
            prompts[Math.floor(Math.random() * prompts.length)];
        const results = emoji.search(keyword);
        if (results.length === 0) {
            return `找不到和 "${keyword}" 相关的表情哦 ~`;
        }
        const formatted = results
            .slice(0, 3)
            .map((item) => `${item.emoji} ${item.name.replace(/_/g, ' ')}`)
            .join(' · ');
        return `${randomPrompt} ${formatted}`;
    });
}

import { Context, h } from 'koishi';
import {getRandomElement} from "../../utils/utils";
import {stickEmoji} from "../../utils/msg_emoji/emoji_helper";

export const name = 'waifu';

export function waifu(ctx: Context) {
    const categories = [
        'waifu', 'neko', 'shinobu', 'megumin', 'bully', 'cuddle', 'cry', 'hug',
        'awoo', 'kiss', 'lick', 'pat', 'smug', 'bonk', 'yeet', 'blush', 'smile',
        'wave', 'highfive', 'handhold', 'nom', 'bite', 'glomp', 'slap', 'kill',
        'kick', 'happy', 'wink', 'poke', 'dance', 'cringe'
    ];

    ctx.command('waifu [category:string]', '获取动漫风格图片')
        .action(async ({ session }, category) => {
            // 检查类别是否有效
            if (category && !categories.includes(category.toLowerCase())) {
                return `无效的类别！可用类别：${categories.join(', ')}`;
            }

            if (session.onebot) {
                await stickEmoji(session, ctx, ["戳一戳"]);
            }

            if (!category) {
                category = getRandomElement(categories);
            }

            try {
                // 调用 waifu.pics API
                const response = await ctx.http.get(`https://api.waifu.pics/sfw/${category.toLowerCase()}`);
                await session.send(h.image(response.url));
            } catch (error) {
                return `获取 ${category} 图片失败，请稍后再试`;
            }
        });

    ctx.command('waifu.categories', '显示所有可用类别')
        .action(() => {
            return `可用类别：${categories.join(', ')}`;
        });
}
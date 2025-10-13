import { Context } from 'koishi';

export function zanwo(ctx: Context) {
    ctx.command('zanwo', '给你点赞')
        .alias('赞我')
        .action(async ({ session }) => {
            if (session.onebot) {
                let num = 0;
                try {
                    for (let i = 0; i < 5; i++) {
                        await session.onebot.sendLike(session.userId, 10);
                        num += 1;
                        await new Promise((r) => setTimeout(r, 1000));
                    }
                    return '搞定啦！记得回赞我哦！';
                } catch (_e) {
                    if (num > 0) return '搞定啦！记得回赞我哦！';
                    return '点赞失败了，可能是今天已经赞过了哦~';
                }
            } else {
                return '赞我命令仅支持 OneBot 适配器哦~';
            }
        });
}

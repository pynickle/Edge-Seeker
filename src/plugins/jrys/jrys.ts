import { Context, Session } from 'koishi';
import {} from 'koishi-plugin-puppeteer';
import {stickEmoji} from "../../utils/msg_emoji/emoji_helper";
import { FortuneData, buildFortuneHtml, calculateFortune } from '../../utils/fortune_helper';

class JrysPlugin {
    constructor(private ctx: Context) {
        this.registerCommands();
    }

    private registerCommands(): void {
        this.ctx.command('jrys', '查看今日运势')
            .action(async ({ session }) => this.handleJrysCommand(session));
    }

    private async handleJrysCommand(session: Session): Promise<string> {
        const fortuneData = await calculateFortune(this.ctx, session.userId, new Date());
        try {
            if (session.onebot) {
                await stickEmoji(session, ['棒棒糖']);
            }
            return await this.renderToImage(fortuneData, session.userId);
        } catch (error) {
            return '生成今日运势图片失败: ' + error.message;
        }
    }

    private async renderToImage(fortuneData: FortuneData, userId: string): Promise<string> {
        const { puppeteer } = this.ctx;

        if (!puppeteer) {
            throw new Error('puppeteer插件未启用');
        }

        const html = buildFortuneHtml(fortuneData, userId);
        return puppeteer.render(html);
    }
}

export default JrysPlugin;
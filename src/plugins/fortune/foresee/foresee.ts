import { Context, Session } from 'koishi';
import {} from 'koishi-plugin-puppeteer';
import { ConfirmationManager, useConfirmationHelper} from '../../../utils/confirmation_helper';
import {getTomorrowString} from '../../../utils/time_helper';
import {buildFortuneHtml, calculateFortune} from '../../../utils/plugins/jrys/fortune_helper';
import {calculateAndStoreLuck, formatLuckMessage} from '../../../utils/plugins/jrrp/random_luck_helper';
import {stickEmoji} from "../../../utils/msg_emoji/emoji_helper";

class ForeseePlugin {
    private confirmationManager: ConfirmationManager;

    constructor(private ctx: Context) {
        this.confirmationManager = useConfirmationHelper(ctx);
        this.setupDatabase();
        this.registerCommands();
    }

    private setupDatabase(): void {
        // 复用 jrrp 的数据库表结构
        this.ctx.model.extend('jrrp', {
            id: 'unsigned',
            userId: 'string',
            date: 'string',
            luck: 'integer',
        }, {
            primary: 'id',
            autoInc: true,
            unique: [['userId', 'date']]
        });
    }

    private registerCommands(): void {
        // 明日人品命令
        this.ctx.command('mrrp', '查看明日人品')
            .action(async ({ session }) => this.handleMrrpCommand(session));

        // 明日运势命令
        this.ctx.command('mrys', '查看明日运势')
            .action(async ({ session }) => this.handleMrysCommand(session));
    }

    // 检查并消耗预知水晶
    private async checkAndConsumeCrystal(session: Session): Promise<boolean> {
        const { userId, channelId, username } = session;

        // 检查用户是否有预知水晶
        const userItems = await this.ctx.database.select('market_user_items')
            .where({ userId, channelId, itemId: 'foresee_crystal' })
            .execute();

        if (userItems.length === 0 || userItems[0].quantity <= 0) {
            await session.send(`@${username}，您没有预知水晶，无法查看明日运势/人品。\n可以在商城购买预知水晶（10 星币）。`);
            return false;
        }

        // 发送确认请求
        await session.send(`⚠️ 查看明日 ${session.content.includes('mrrp') ? '人品' : '运势'} 需要消耗1个预知水晶，您确定要继续吗？
请发送「确认」继续，「取消」放弃操作（20 秒后自动取消）`);

        // 创建确认 Promise
        const confirmed = await this.confirmationManager.createConfirmation(this.ctx, session, 20);
        if (!confirmed) {
            await session.send('❌ 操作已取消或超时');
            return false;
        }

        // 消耗预知水晶
        if (userItems[0].quantity === 1) {
            await this.ctx.database.remove('market_user_items', {
                userId, channelId, itemId: 'foresee_crystal'
            });
        } else {
            await this.ctx.database.set('market_user_items',
                { userId, channelId, itemId: 'foresee_crystal' },
                { quantity: userItems[0].quantity - 1 }
            );
        }

        return true;
    }

    // 处理明日人品命令
    private async handleMrrpCommand(session: Session): Promise<string> {
        // 检查并消耗预知水晶
        const hasCrystal = await this.checkAndConsumeCrystal(session);
        if (!hasCrystal) {
            return '';
        }

        const tomorrow = getTomorrowString();

        // 计算并存储明日人品值
        const luck = await calculateAndStoreLuck(this.ctx, session, tomorrow);
        return formatLuckMessage(this.ctx, session, tomorrow, luck);
    }

    // 处理明日运势命令
    private async handleMrysCommand(session: Session): Promise<string> {
        // 检查并消耗预知水晶
        const hasCrystal = await this.checkAndConsumeCrystal(session);
        if (!hasCrystal) {
            return '';
        }

        try {
            // 获取明日的日期
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            // 计算明日运势数据
            const fortuneData = await calculateFortune(this.ctx, session.userId, tomorrow);
            
            // 添加表情
            if (session.onebot) {
                await stickEmoji(this.ctx, session, ['棒棒糖']);
            }
            
            // 渲染为图片输出
            const { puppeteer } = this.ctx;

            const html = buildFortuneHtml(fortuneData, session.userId, true);
            return await puppeteer.render(html);
        } catch (error) {
            return `生成明日运势失败: ${error.message}`;
        }
    }
}

export default ForeseePlugin;
import { Context, Session } from 'koishi';
import { Solar } from 'lunar-typescript';
import crypto from 'crypto';
import {} from 'koishi-plugin-puppeteer';
import axios from "axios";
import {getRandomElement} from "../../utils/utils";
import {stickEmoji} from "../../utils/msg_emoji/emoji_helper";

// 定义运势数据接口
export interface FortuneData {
    score: number; // 运势分数
    randomNum: number; // 每日固定随机数
    sentence: string; // 一言内容
    sentenceFrom: string; // 一言出处
    dos: string; // 宜
    donts: string; // 忌
    luckyColor: string; // 幸运颜色
    luckyNumber: number; // 幸运数字
    solarDate: string; // 阳历日期
}

const COLORMAP: Record<string, string> = {
    '红色': '#ff0000',
    '橙色': '#ffa500',
    '黄色': '#ffff00',
    '绿色': '#008000',
    '青色': '#00ffff',
    '蓝色': '#0000ff',
    '紫色': '#800080',
    '粉色': '#ffc0cb',
    '金色': '#ffd700',
    '银色': '#c0c0c0',
    '黑色': '#000000',
    '灰色': '#808080',
    '棕色': '#a52a2a',
    '米色': '#f5f5dc'
};

class JrysPlugin {
    constructor(private ctx: Context) {
        this.registerCommands();
    }

    private registerCommands(): void {
        this.ctx.command('jrys', '查看今日运势')
            .action(async ({ session }) => this.handleJrysCommand(session));
    }

    private async handleJrysCommand(session: Session): Promise<string> {
        try {
            await stickEmoji(session, ['棒棒糖']);
            const fortuneData = await this.calculateFortune(session.userId);
            return await this.renderToImage(fortuneData, session.userId);
        } catch (error) {
            return '生成今日运势图片失败: ' + error.message;
        }
    }

    private async calculateFortune(userId: string): Promise<FortuneData> {
        const today = new Date();
        const solar = Solar.fromDate(today);
        const lunar = solar.getLunar();

        const seed = `${userId}${today.getFullYear()}${today.getMonth() + 1}${today.getDate()}`;
        const random = this.getPseudoLcgRandomGenerator(seed);
        const randomXorshift = this.getPseudoXorshiftRandomGenerator(seed);

        const randomNum = random();
        const randomNumXorshift = randomXorshift();

        // 计算运势分数（1-100）
        const score = Math.floor(randomNum * 100) + 1;

        // 计算幸运颜色
        const luckyColors : string[] = Object.keys(COLORMAP) as Array<string>;
        const luckyColor : string = getRandomElement<string>(luckyColors, random);

        // 计算幸运数字（1-100）
        const luckyNumber = Math.floor(randomNumXorshift * 100) + 1;

        // 获取阳历日期字符串
        const solarDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

        // 获取宜和忌
        const dos = lunar.getDayYi().slice(0, 10).join(' ');
        const donts = lunar.getDayJi().slice(0, 10).join(' ');

        let sentence: string, sentenceFrom: string;
        try {
            const res = await axios.get("https://v1.hitokoto.cn", {
                timeout: 5000,
                params: {
                    max_length: 20
                }
            });
            sentence = res.data.hitokoto;
            sentenceFrom = res.data.from;
        } catch (error) {
            let errorMessage = '喵~ 获取一言数据出错了，稍后再试吧！';
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                    throw Error('请求超时了，网络可能不稳定，再试一次？');
                } else if (error.response) {
                    throw Error(`API错误：${error.response.status} - ${error.response.statusText}`);
                } else if (error.request) {
                    throw Error('网络连接问题，无法访问API。');
                }
            }
            throw Error(errorMessage);
        }

        return {
            score,
            randomNum,
            dos,
            donts,
            luckyColor,
            luckyNumber,
            solarDate,
            sentence,
            sentenceFrom
        };
    }

    private getPseudoLcgRandomGenerator(seed: string): () => number {
        const hash = crypto.createHash('md5').update(seed).digest('hex');
        let state = parseInt(hash.substring(0, 8), 16);

        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    }

    private getPseudoXorshiftRandomGenerator(seed: string): () => number {
        // 使用 MD5 将种子转换为 32 位整数
        const hash = crypto.createHash('md5').update(seed).digest('hex');
        let state = parseInt(hash.substring(0, 8), 16) >>> 0; // 无符号 32 位整数

        return () => {
            // Xorshift32 算法
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            // 确保 state 是无符号 32 位整数
            state = state >>> 0;
            // 归一化到 [0, 1)
            return state / 4294967296;
        };
    }

    private async renderToImage(fortuneData: FortuneData, userId: string): Promise<string> {
        const { puppeteer } = this.ctx;

        if (!puppeteer) {
            throw new Error('puppeteer插件未启用');
        }

        const html = this.buildHtmlContent(fortuneData, userId);
        return puppeteer.render(html);
    }

    private buildHtmlContent(fortuneData: FortuneData, userId: string): string {
        const luckyColorValue = this.getColorValue(fortuneData.luckyColor);

        return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=400, initial-scale=1.0">
    <title>今日运势</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@7.0.1/css/all.min.css">
    <style>
        body {
            width: 400px;
            margin: 0 auto;
            background: #f8f8f8;
            font-size: 14px;
        }
        .container {
            background: #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 6px;
            overflow: hidden;
        }
        .hero-image {
            position: relative;
            width: 400px;
            height: 120px;
        }
        .hero-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 6px 6px 0 0;
        }
        .hero-text {
            position: absolute;
            bottom: 10px;
            right: 10px;
            color: #fff;
            text-shadow: 0 0 3px rgba(0,0,0,0.8);
            text-align: right;
        }
        .hero-date {
            position: absolute;
            top: 10px;
            left: 10px;
            background: #4a4a4a; /* 使用深灰色纯色背景 */
            border: none; /* 移除边框 */
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            color: #fff;
        }
        .content {
            padding: 0.75rem;
            text-align: center;
            border-top: 2px solid #fff;
            background: #fff;
        }
        .avatar {
            position: absolute;
            top: 96px;
            left: 20px;
            width: 48px;
            height: 48px;
            z-index: 10;
        }
        .avatar img {
            border: 2px solid #fff;
            border-radius: 4px;
            width: 100%;
            height: 100%;
        }
        .content-inner {
            margin-top: 6px;
        }
        .icon {
            color: ${luckyColorValue};
            margin-right: 0.5rem;
        }
    </style>
</head>
<body>
<div class="container">
    <div class="hero-image">
        <img src="https://picsum.photos/seed/${fortuneData.randomNum}/400/120" alt="每日运势占位图">
        <div class="hero-text">
            <p class="title is-4 has-text-white">今日运势</p>
        </div>
        <div class="hero-date">
            <p class="subtitle is-6 has-text-white">${fortuneData.solarDate}</p>
        </div>
        <figure class="avatar">
            <img src="https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=48" alt="头像">
        </figure>
    </div>
    <div class="content">
        <div class="content-inner">
            <p class="title is-4"><i class="fas fa-chart-line icon"></i>运势指数: ${fortuneData.score}</p>
            <p class="subtitle is-6 mt-4" style="margin-bottom: 3px"><i class="fas fa-quote-left icon"></i>${fortuneData.sentence}</p>
            <p class="is-7">—— ${fortuneData.sentenceFrom}</p>
            <p class="mt-2"><i class="fas fa-dice icon"></i><strong>幸运数字:</strong> ${fortuneData.luckyNumber}</p>
            <p><i class="fas fa-palette icon"></i><strong>幸运颜色:</strong> ${fortuneData.luckyColor}</p>
            <p class="mt-2"><strong>宜:</strong> ${fortuneData.dos}</p>
            <p><strong>忌:</strong> ${fortuneData.donts}</p>
        </div>
    </div>
</div>
</body>
</html>
        `;
    }

    private getColorValue(colorName: string): string {
        return COLORMAP[colorName] || '#000000';
    }
}

export default JrysPlugin;
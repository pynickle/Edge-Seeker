import {Context, Session} from 'koishi';
import {Solar} from 'lunar-typescript';
import {Config} from '../../index';
import crypto from 'crypto';
import {} from 'koishi-plugin-puppeteer';
import axios from "axios";

// 定义运势数据接口
export interface FortuneData {
    score: number;
    sentence: string;
    sentenceFrom: string;
    dos: string;
    donts: string;
    luckyColor: string;
    luckyNumber: number;
    solarDate: string;
}

declare module 'koishi' {
    interface Tables {
        jrys: {}
    }
}

// 运势等级配置
const FORTUNE_LEVELS = [
    {min: 90, level: '极佳', color: '#ffd700', bgColor: 'rgba(255, 215, 0, 0.1)'},
    {min: 70, level: '良好', color: '#32cd32', bgColor: 'rgba(50, 205, 50, 0.1)'},
    {min: 50, level: '一般', color: '#4169e1', bgColor: 'rgba(65, 105, 225, 0.1)'},
    {min: 30, level: '较差', color: '#ff7f50', bgColor: 'rgba(255, 127, 80, 0.1)'},
    {min: 0, level: '很差', color: '#dc143c', bgColor: 'rgba(220, 20, 60, 0.1)'}
];

// 幸运颜色
const LUCKY_COLORS = [
    '红色', '橙色', '黄色', '绿色', '青色',
    '蓝色', '紫色', '粉色', '金色', '银色',
    '黑色', '白色', '灰色', '棕色', '米色'
];

class JrysPlugin {
    constructor(private ctx: Context, private config: Config) {
        this.registerCommands();
    }

    private registerCommands(): void {
        this.ctx.command('jrys', '查看今日运势')
            .action(async ({session}) => this.handleJrysCommand(session));
    }

    private async handleJrysCommand(session: Session): Promise<string> {
        try {
            // 获取用户的运势数据
            const fortuneData = this.calculateFortune(session.userId);
            // 生成运势图片
            return await this.renderToImage(await fortuneData);
        } catch (error) {
            console.error('生成今日运势图片失败:', error);
            return '生成今日运势图片失败，请稍后重试。';
        }
    }

    private async calculateFortune(userId: string): Promise<FortuneData> {
        const today = new Date();
        const solar = Solar.fromDate(today);
        const lunar = solar.getLunar();

        // 生成基于用户ID和日期的随机种子
        const seed = `${userId}${today.getFullYear()}${today.getMonth() + 1}${today.getDate()}`;
        const random = this.getPseudoRandomGenerator(seed);

        // 计算运势得分（0-100）
        const score = Math.floor(random() * 100) + 1;

        // 计算幸运颜色和数字
        const luckyColor = LUCKY_COLORS[Math.floor(random() * LUCKY_COLORS.length)];
        const luckyNumber = Math.floor(random() * 99) + 1;

        // 格式化日期
        const solarDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

        const dos = lunar.getDayYi().join(' ');
        const donts = lunar.getDayJi().join(' ');

        let sentence, sentenceFrom;
        try {
            const res = await axios.get("https://v1.hitokoto.cn", {
                timeout: 5000, // 5秒超时
            });
            sentence = res.data.hitokoto;
            sentenceFrom = res.data.from;
        } catch (error) {
            // 更细化的错误判断和处理
            let errorMessage = '喵~ 获取猫图片出错了，稍后再试吧！';

            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                    throw Error('请求超时了，网络可能不稳定，再试一次？');
                } else if (error.response) {
                    // API返回错误（如4xx/5xx）
                    throw Error(`API错误：${error.response.status} - ${error.response.statusText}`);
                } else if (error.request) {
                    // 请求发出但无响应（网络问题）
                    throw Error('网络连接问题，无法访问API。');
                }
            }
            throw Error(errorMessage);
        }

        return {
            score,
            dos,
            donts,
            luckyColor,
            luckyNumber,
            solarDate,
            sentence,
            sentenceFrom
        };
    }

    // 基于种子生成伪随机数的函数
    private getPseudoRandomGenerator(seed: string): () => number {
        // 使用MD5生成种子的哈希值
        const hash = crypto.createHash('md5').update(seed).digest('hex');
        // 取前8个字符作为种子
        let state = parseInt(hash.substring(0, 8), 16);

        // 线性同余生成器
        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    }

    private async renderToImage(fortuneData: FortuneData): Promise<string> {
        // 使用puppeteer渲染图片
        const {puppeteer} = this.ctx;

        if (!puppeteer) {
            throw new Error('puppeteer插件未启用');
        }

        // 构建HTML内容
        const html = this.buildHtmlContent(fortuneData);

        return puppeteer.render(html);
    }

    private buildHtmlContent(fortuneData: FortuneData): string {
        // 获取运势等级对应的颜色
        const levelInfo = FORTUNE_LEVELS.find(level => level.level === fortuneData.level);
        const levelColor = levelInfo?.color || '#000000';

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
            background: rgba(255,255,255,0.2);
            border: 1px solid #fff;
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            color: #fff;
        }
        .content {
            padding: 0.75rem;
            text-align: center;
            border-top: 2px solid #fff;
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
            margin-top: 28px;
        }
        .icon {
            color: #3273dc;
            margin-right: 0.5rem;
        }
    </style>
</head>
<body>
<div class="container">
    <div class="hero-image">
        <img src="https://picsum.photos/400/120" alt="每日运势占位图">
        <div class="hero-text">
            <p class="title is-4 has-text-white">今日运势</p>
        </div>
        <div class="hero-date">
            <p class="subtitle is-6 has-text-white">2025年9月20日</p>
        </div>
        <figure class="avatar">
            <img src="https://picsum.photos/48/48?random=1" alt="头像">
        </figure>
    </div>
    <div class="content">
        <div class="content-inner">
            <p class="title is-4"><i class="fas fa-chart-line icon"></i>运势指数: ${levelInfo}</p>
            <p class="subtitle is-6 mt-4" style="margin-bottom: 3px"><i class="fas fa-quote-left icon"></i>生活是一面镜子，你对它微笑，它就对你微笑。</p>
            <p class="is-7">—— 佚名</p>
            <p class="mt-2"><i class="fas fa-dice icon"></i><strong>幸运数字:</strong> 7</p>
            <p><i class="fas fa-palette icon"></i><strong>幸运颜色:</strong> 蓝色</p>
            <p class="mt-2"><strong>宜:</strong> 出行、会友、学习</p>
            <p><strong>忌:</strong> 搬家、争吵、冒险投资</p>
        </div>
    </div>
</div>
</body>
</html>
        `;
    }

    // 根据分数获取渐变背景色
    private getGradientColor(score: number): string {
        if (score >= 90) return '#ffd700'; // 金色
        if (score >= 70) return '#32cd32'; // 绿色
        if (score >= 50) return '#4169e1'; // 蓝色
        if (score >= 30) return '#ff7f50'; // 珊瑚色
        return '#dc143c'; // 深红色
    }

    // 调整颜色亮度
    private lightenColor(color: string): string {
        // 简单的颜色亮度调整实现
        const colors = {
            '#ffd700': '#fffacd',
            '#32cd32': '#90ee90',
            '#4169e1': '#87cefa',
            '#ff7f50': '#ffb6c1',
            '#dc143c': '#ffb6c1'
        };

        return colors[color as keyof typeof colors] || color;
    }

    // 获取颜色的实际值
    private getColorValue(colorName: string): string {
        const colorMap: Record<string, string> = {
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
            '白色': '#ffffff',
            '灰色': '#808080',
            '棕色': '#a52a2a',
            '米色': '#f5f5dc'
        };

        return colorMap[colorName] || '#000000';
    }
}

export default JrysPlugin;
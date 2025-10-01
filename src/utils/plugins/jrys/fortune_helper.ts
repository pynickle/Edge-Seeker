import { Context } from 'koishi';
import { Solar } from 'lunar-typescript';
import axios from 'axios';
import { BiasType, random, randomChoice, randomInt } from '../../pseudo_random_helper';
import { hasActiveBuff } from '../../prop_helper';
import { BuffType } from '../../../plugins/currency/prop/inventory/inventory';

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

export const COLORMAP: Record<string, string> = {
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

/**
 * 计算运势数据
 */
export async function calculateFortune(
    ctx: Context,
    userId: string,
    targetDate: Date,
    isTomorrow: boolean = false
): Promise<FortuneData> {
    const solar = Solar.fromDate(targetDate);
    const lunar = solar.getLunar();

    // 生成种子，区分今日和明日
    const seed1 = `${userId}${targetDate.getFullYear()}${targetDate.getMonth()}${targetDate.getDate()}`;
    const seed2 = `${seed1}_;Y?hv7P.aFLf[w]?O"}MBsc')V=)hD(?)`;

    // 确定是否有幸运卡加成
    let bias: BiasType = 'none';
    if (!isTomorrow) { // 只有今日运势才考虑幸运卡效果
        const hasLuckyCard = await hasActiveBuff(ctx, userId, BuffType.LUCKY_CARD);
        if (hasLuckyCard) {
            bias = 'slight_up';
        }
    }

    // 计算每日固定随机数
    const randomNum = random(seed1);

    // 计算运势分数（1-100）
    const score = randomInt(1, 100, seed1, { bias });

    // 计算幸运颜色
    const luckyColors: string[] = Object.keys(COLORMAP) as Array<string>;
    const luckyColor: string = randomChoice<string>(luckyColors, seed2);

    // 计算幸运数字（1-100）
    const luckyNumber = randomInt(1, 100, seed2);

    // 获取阳历日期字符串
    const solarDate = `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;

    // 获取宜和忌
    const dos = lunar.getDayYi().slice(0, 7).join(' ');
    const donts = lunar.getDayJi().slice(0, 7).join(' ');

    // 获取一言数据
    let sentence: string, sentenceFrom: string;
    try {
        // 对于今日运势，尝试获取真实的一言数据
        const res = await axios.get('http://hitokoto_api:8000', {
            timeout: 5000
        });
        sentence = res.data.hitokoto;
        sentenceFrom = res.data.from;
    } catch (error) {
        // 出错时使用备用的一言数据
        const fallbackSentences = [
            '心若向阳，无畏悲伤。',
            '一切都会好起来的。',
            '每一个平凡的日子都值得珍惜。',
            '保持微笑，好运自然来。',
            '今天也要元气满满！'
        ];
        sentence = randomChoice(fallbackSentences);
        sentenceFrom = '系统提示';
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

/**
 * 构建运势图片的 HTML 内容
 */
export function buildFortuneHtml(fortuneData: FortuneData, userId: string, isTomorrow: boolean = false): string {
    const luckyColorValue = getColorValue(fortuneData.luckyColor);
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=400, initial-scale=1.0">
    <title>${isTomorrow ? '明日' : '今日'}运势</title>
    <link rel="stylesheet" href="https://cdn.bootcdn.net/ajax/libs/font-awesome/7.0.1/css/all.min.css">
    <link href="https://cdn.bootcdn.net/ajax/libs/bulma/1.0.4/css/bulma.min.css" rel="stylesheet">
    <style>
        body {
            width: 400px;
            margin: 0 auto;
            background: #f8f8f8;
            font-size: 14px;
            font-family: "Maple Mono NF CN",serif;
            font-weight: normal;
        }
        .content blockquote:not(:last-child), .content dl:not(:last-child), .content ol:not(:last-child), .content p:not(:last-child), .content pre:not(:last-child), .content table:not(:last-child), .content ul:not(:last-child) {
            margin-bottom: 8px;
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
            background: #4a4a4a;
            border: none;
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
            <p class="title is-4 has-text-white">${isTomorrow ? '明日' : '今日'}运势</p>
        </div>
        <div class="hero-date">
            <p class="subtitle is-6 has-text-white">${fortuneData.solarDate}</p>
        </div>
        <figure class="avatar">
            <img src="https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640" alt="头像">
        </figure>
    </div>
    <div class="content">
        <div class="content-inner">
            <p class="title is-4"><i class="fas fa-chart-line icon"></i>运势指数: ${fortuneData.score}</p>
            <p class="subtitle is-6 mt-4 mb-1"><i class="fas fa-quote-left icon"></i>${fortuneData.sentence}</p>
            <p class="is-7">—— ${fortuneData.sentenceFrom}</p>
            <p class="mt-4"><i class="fas fa-dice icon"></i><strong>幸运数字:</strong> ${fortuneData.luckyNumber}</p>
            <p><i class="fas fa-palette icon"></i><strong>幸运颜色:</strong> ${fortuneData.luckyColor}</p>
            <p class="mt-3"><strong>宜:</strong> ${fortuneData.dos}</p>
            <p><strong>忌:</strong> ${fortuneData.donts}</p>
        </div>
    </div>
</div>
</body>
</html>
    `;
}

/**
 * 获取颜色的十六进制值
 */
export function getColorValue(colorName: string): string {
    return COLORMAP[colorName] || '#000000';
}
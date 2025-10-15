import axios from 'axios';
import { Context } from 'koishi';
import 'koishi-plugin-puppeteer';
import { Solar } from 'lunar-typescript';
import { BuffType } from '../../../plugins/currency/prop/inventory/inventory';
import { hasActiveBuff } from '../../prop_helper';
import {
    BiasType,
    random,
    randomChoice,
    randomInt,
} from '../../pseudo_random_helper';

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

// 英文键的颜色映射
export const COLOR_MAP: Record<string, string> = {
    red: '#ff0000',
    orange: '#ffa500',
    yellow: '#ffff00',
    green: '#008000',
    cyan: '#00ffff',
    blue: '#0000ff',
    purple: '#800080',
    pink: '#ffc0cb',
    gold: '#ffd700',
    silver: '#c0c0c0',
    black: '#000000',
    gray: '#808080',
    brown: '#a52a2a',
    beige: '#f5f5dc',
};

// 英文键到中文显示名称的映射
export const COLOR_NAME_MAP: Record<string, string> = {
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    cyan: '青色',
    blue: '蓝色',
    purple: '紫色',
    pink: '粉色',
    gold: '金色',
    silver: '银色',
    black: '黑色',
    gray: '灰色',
    brown: '棕色',
    beige: '米色',
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
    if (!isTomorrow) {
        // 只有今日运势才考虑幸运卡效果
        const hasLuckyCard = await hasActiveBuff(
            ctx,
            userId,
            BuffType.LUCKY_CARD
        );
        if (hasLuckyCard) {
            bias = 'slight_up';
        }
    }

    // 计算每日固定随机数
    const randomNum = random(seed1);

    // 计算运势分数（1-100）
    const score = randomInt(1, 100, seed1, { bias });

    // 计算幸运颜色（英文键）
    const colorKeys: string[] = Object.keys(COLOR_MAP) as Array<string>;
    const englishColorKey: string = randomChoice<string>(colorKeys, seed2);
    // 转换为中文显示名称
    const luckyColor: string = COLOR_NAME_MAP[englishColorKey];

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
            timeout: 5000,
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
            '今天也要元气满满！',
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
        sentenceFrom,
    };
}

/**
 * 获取图片并转换为base64格式，支持超时和备用图片
 */
export async function getFortuneImageBase64(
    randomNum: number
): Promise<string> {
    const picsumUrl = `https://picsum.photos/seed/${randomNum}/400/120`;

    try {
        const response = await axios.get(picsumUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
        });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        return `data:image/jpeg;base64,${base64}`;
    } catch (error) {
        const randomImageNum = randomInt(1, 5);
        const backupUrl = `http://47.117.27.240:5140/files/${randomImageNum}.jpg`;
        try {
            const backupResponse = await axios.get(backupUrl, {
                responseType: 'arraybuffer',
                timeout: 10000,
            });
            const base64 = Buffer.from(backupResponse.data, 'binary').toString(
                'base64'
            );
            return `data:image/jpeg;base64,${base64}`;
        } catch (backupError) {
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        }
    }
}

/**
 * 构建运势图片的 HTML 内容
 */
export function buildFortuneHtml(
    fortuneData: FortuneData,
    userId: string,
    isTomorrow: boolean = false
): string {
    const imageUrl = getFortuneImageBase64(fortuneData.randomNum);
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
        <img src="${imageUrl}" alt="每日运势图片">
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
    // 如果传入的是英文键，直接从 COLOR_MAP 获取
    if (COLOR_MAP[colorName]) {
        return COLOR_MAP[colorName];
    }

    // 如果传入的是中文名称，查找对应的英文键
    const englishKey = Object.keys(COLOR_NAME_MAP).find(
        (key) => COLOR_NAME_MAP[key] === colorName
    );
    if (englishKey) {
        return COLOR_MAP[englishKey] || '#000000';
    }

    return '#000000';
}

import {Context} from 'koishi';
import axios from 'axios';
import {createFileMsg, createTextMsg, getUserName} from "../../utils/onebot_helper";

export const name = 'cat';

export function cat(ctx: Context) {
    ctx.command('cat', '获取一张随机猫片')
        .action(async ({session}) => {
            try {
                if (session.onebot) {
                    const loadingMsgNumber = await session.onebot.sendGroupMsg(session.channelId, [
                        createTextMsg('喵~ 正在为你寻找可爱的猫片...')
                    ])

                    // 调用 The Cat API 获取随机猫图片
                    const response = await axios.get('https://api.thecatapi.com/v1/images/search', {
                        timeout: 5000, // 5秒超时
                    });
                    const catImageUrl = response.data[0].url;

                    // 返回图片消息
                    await session.onebot.sendGroupMsg(session.channelId, [
                        createFileMsg(catImageUrl, "image")])
                    await session.onebot.deleteMsg(loadingMsgNumber);
                } else {
                    return '喵~ 这个命令只能在 OneBot 平台使用哦！';
                }
            } catch (error) {
                // 更细化的错误判断和处理
                let errorMessage = '喵~ 获取猫图片出错了，稍后再试吧！';

                if (axios.isAxiosError(error)) {
                    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                        errorMessage = '请求超时了，网络可能不稳定，再试一次？';
                    } else if (error.response) {
                        // API返回错误（如4xx/5xx）
                        errorMessage = `API 错误：${error.response.status} - ${error.response.statusText}`;
                    } else if (error.request) {
                        // 请求发出但无响应（网络问题）
                        errorMessage = '网络连接问题，无法访问API。';
                    }
                }

                return errorMessage;
            }
        });
}
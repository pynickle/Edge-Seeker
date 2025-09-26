import {Session, Context} from 'koishi'
import {EMOJI_MAP} from "./emoji_mapping";

function resolveEmojiId(input: string): string | null {
    if (EMOJI_MAP[input]) return EMOJI_MAP[input];
}

async function addReaction(session: Session, messageId: number | string, emojiId: string) {
    await session.onebot._request('set_msg_emoji_like', {message_id: messageId, emoji_id: emojiId});
}

export async function stickEmoji(ctx: Context, session: Session, emojis: string[]) {
    try {
        const targetId = session.messageId;

        for (const emoji of emojis.slice(0, 20)) {
            const id = resolveEmojiId(emoji);
            await addReaction(session, targetId, id);
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        ctx.logger.warn("表情回应失败: " + e);
    }
}
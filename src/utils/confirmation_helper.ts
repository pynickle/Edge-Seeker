import { Context, Session } from 'koishi';

/**
 * 确认管理器，用于处理用户的确认/取消操作
 */
export class ConfirmationManager {
    private pendingConfirmations = new Map<string, {
        resolve: (value: boolean) => void,
        timer: ReturnType<typeof setTimeout>
    }>();

    /**
     * 创建一个确认请求
     * @param ctx Koishi上下文
     * @param session 会话对象
     * @param timeout 超时时间（秒）
     * @returns Promise<boolean> 确认结果，true表示确认，false表示取消或超时
     */
    createConfirmation(ctx: Context, session: Session, timeout: number): Promise<boolean> {
        const key = `${session.platform}:${session.userId}`;

        // 如果已经有未确认的请求，拒绝新请求
        if (this.pendingConfirmations.has(key)) {
            throw new Error('您已有未完成的确认操作');
        }

        // 创建确认 Promise
        const confirmationPromise = new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
                this.pendingConfirmations.delete(key);
                resolve(false);
            }, timeout * 1000);

            this.pendingConfirmations.set(key, { resolve, timer });
        });

        return confirmationPromise;
    }

    /**
     * 处理确认/取消消息的中间件
     */
    createMiddleware() {
        const manager = this;
        return async (session: Session, next: () => Promise<void>) => {
            const key = `${session.platform}:${session.userId}`;
            const confirmation = manager.pendingConfirmations.get(key);

            if (confirmation && /^(确认|取消)$/.test(session.content?.trim() || '')) {
                clearTimeout(confirmation.timer);
                manager.pendingConfirmations.delete(key);
                confirmation.resolve(session.content.trim() === '确认');
                return;
            }

            return next();
        };
    }
}

/**
 * 确认辅助函数，用于插件快速注册确认功能
 * @param ctx Koishi上下文
 * @returns ConfirmationManager 确认管理器实例
 */
export function useConfirmationHelper(ctx: Context): ConfirmationManager {
    const manager = new ConfirmationManager();
    ctx.middleware(manager.createMiddleware(), true);
    return manager;
}
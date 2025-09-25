export function getTodayString(): string {
    return formatDate(new Date());
}

export function formatDate(date: Date): string {
    return date.toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).split('/').join('-');
}
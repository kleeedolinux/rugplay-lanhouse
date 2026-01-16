import { db } from './db';
import { notifications, notificationTypeEnum } from './db/schema';
import { broadcastNotification } from './websocket-api';

export type NotificationType = typeof notificationTypeEnum.enumValues[number];

export async function createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
): Promise<void> {
    await db.insert(notifications).values({
        userId: parseInt(userId),
        type,
        title,
        message,
        link
    });

    try {
        const payload = {
            type: 'notification',
            timestamp: new Date().toISOString(),
            userId,
            notificationType: type,
            title,
            message,
            link
        };

        await broadcastNotification(userId, payload);
    } catch (error) {
        console.error('Failed to send notification via WebSocket:', error);
    }
}

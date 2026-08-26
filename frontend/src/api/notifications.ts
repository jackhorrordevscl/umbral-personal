import api from './client';
import type { Notification, UnreadCount } from '../types/notification';

export function listNotifications() {
  return api.get<Notification[]>('/notifications').then((r) => r.data);
}

export function getUnreadCount() {
  return api.get<UnreadCount>('/notifications/unread-count').then((r) => r.data);
}

export function markNotificationRead(id: string) {
  return api.patch<Notification>(`/notifications/${id}/read`).then((r) => r.data);
}

export function markAllNotificationsRead() {
  return api.patch<UnreadCount>('/notifications/read-all').then((r) => r.data);
}

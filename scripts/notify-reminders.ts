import { runNotificationReminders } from "../src/features/notifications/service";
import { database } from "../src/server/db";
try {
  const result = await runNotificationReminders();
  console.log(`Notification reminders checked: ${result.processed}`);
} finally {
  await database().$disconnect();
}

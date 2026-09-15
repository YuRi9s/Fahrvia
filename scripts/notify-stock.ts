/** Schedule periodically (for example every five minutes). In-app notifications only. */
import { reconcileStockAlerts } from "../src/features/inventory/alerts";
import { database } from "../src/server/db";
try {
  const result = await reconcileStockAlerts();
  console.log(`Stock alerts checked for ${result.processed} items.`);
} finally {
  await database().$disconnect();
}

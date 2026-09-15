import { database } from "../../server/db";
import { AppError, demand, type Principal } from "../../server/policy";
function pageNumber(raw: string | null) {
  const n = Number(raw ?? 1);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1;
}
/** Every aggregation is scoped before grouping, including administrator requests. */
export async function conversations(p: Principal, params: URLSearchParams) {
  demand(p, "messages", "read");
  const db = database(),
    page = pageNumber(params.get("page")),
    pageSize = 20,
    offset = (page - 1) * pageSize,
    query = `%${(params.get("q") ?? "").slice(0, 120)}%`;
  const rows = await db.$queryRaw<
    {
      id: string;
      subject: string;
      body: string;
      senderId: string;
      recipientId: string;
      createdAt: Date;
      unread: bigint;
    }[]
  >`
 WITH scoped AS (SELECT *, COALESCE("threadId",id) AS thread FROM "Message" WHERE "organizationId"=${p.organizationId} AND ("senderId"=${p.userId} OR "recipientId"=${p.userId})),
 counts AS (SELECT thread, COUNT(*) FILTER(WHERE "recipientId"=${p.userId} AND "readAt" IS NULL) AS unread FROM scoped GROUP BY thread),
 latest AS (SELECT DISTINCT ON(thread) thread AS id, subject,body,"senderId","recipientId","createdAt" FROM scoped ORDER BY thread,"createdAt" DESC,id DESC)
 SELECT latest.*,counts.unread FROM latest JOIN counts ON latest.id=counts.thread WHERE EXISTS(SELECT 1 FROM scoped s WHERE s.thread=latest.id AND (s.subject ILIKE ${query} OR s.body ILIKE ${query})) ORDER BY "createdAt" DESC,latest.id LIMIT ${pageSize} OFFSET ${offset}`;
  const total = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT COUNT(DISTINCT COALESCE("threadId",id)) AS count FROM "Message" WHERE "organizationId"=${p.organizationId} AND ("senderId"=${p.userId} OR "recipientId"=${p.userId}) AND (subject ILIKE ${query} OR body ILIKE ${query})`;
  const ids = [
    ...new Set(
      rows.map((r) => (r.senderId === p.userId ? r.recipientId : r.senderId)),
    ),
  ];
  const members = await db.membership.findMany({
    where: { organizationId: p.organizationId, userId: { in: ids } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return {
    items: rows.map((r) => ({
      ...r,
      body: r.body.slice(0, 120),
      unread: Number(r.unread),
      participantId: r.senderId === p.userId ? r.recipientId : r.senderId,
      participantName:
        members.find(
          (m) =>
            m.userId === (r.senderId === p.userId ? r.recipientId : r.senderId),
        )?.user.name ?? "Ehemaliges Mitglied",
    })),
    page,
    pageSize,
    total: Number(total[0]?.count ?? 0),
  };
}
export async function conversationHistory(
  p: Principal,
  id: string,
  params: URLSearchParams,
) {
  demand(p, "messages", "read");
  if (!id || id.length > 100)
    throw new AppError(404, "Unterhaltung nicht gefunden.");
  const page = pageNumber(params.get("page")),
    pageSize = 30;
  const where = {
    organizationId: p.organizationId,
    threadId: id,
    OR: [{ senderId: p.userId }, { recipientId: p.userId }],
  };
  const db = database(),
    total = await db.message.count({ where });
  if (!total) throw new AppError(404, "Unterhaltung nicht gefunden.");
  const items = await db.message.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize,
    skip: (page - 1) * pageSize,
    select: {
      id: true,
      threadId: true,
      subject: true,
      body: true,
      senderId: true,
      recipientId: true,
      readAt: true,
      createdAt: true,
    },
  });
  return { items, page, pageSize, total };
}

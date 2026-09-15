import { parseListOptions } from "./list-options";
import { investigate } from "../features/audit/service";
import { notificationScope } from "../features/notifications/service";
import { listAccounts } from "../features/accounts/service";
import { listInvitations } from "../features/invitations/service";
import { database } from "./db";
import { AppError, demand, type Principal } from "./policy";
import { checkWeek, isoWeek, weekRange } from "./validation";
const driverName = (d: { firstName: string; lastName: string }) =>
  `${d.firstName} ${d.lastName}`;
/** List queries apply row ownership before pagination and never send hidden peer records. */
export async function listModule(
  p: Principal,
  module: string,
  params: URLSearchParams = new URLSearchParams(),
) {
  demand(p, module, "read");
  if (module === "audit") return investigate(p, params);
  const options = parseListOptions(module, params);
  const db = database(),
    organizationId = p.organizationId,
    own = p.role === "DRIVER";
  const selectedWeek =
    params.get("week") || (module === "planning" ? isoWeek(new Date()) : "");
  const range = selectedWeek ? weekRange(selectedWeek) : undefined;
  const page = Math.trunc(
    Math.max(1, Math.min(100000, Number(params.get("page")) || 1)),
  );
  const pageSize = Math.trunc(
    Math.max(1, Math.min(100, Number(params.get("pageSize")) || 25)),
  );
  const skip = (page - 1) * pageSize,
    take = pageSize,
    q = (params.get("q") ?? "").slice(0, 120),
    status = params.get("status"),
    selectedId = params.get("id")?.slice(0, 200);
  const search = (fields: string[]) =>
    q
      ? {
          OR: fields.map((field) => ({
            [field]: { contains: q, mode: "insensitive" as const },
          })),
        }
      : {};
  const result = (items: unknown[], total: number) => ({
    items,
    total,
    page,
    pageSize,
  });
  if (module === "accounts") return listAccounts(p, params);
  if (module === "invitations") return listInvitations(p, params);
  if (module === "dashboard") return dashboard(p);
  if (module === "drivers") {
    const where = {
      organizationId,
      ...(own ? { id: p.driverId! } : {}),
      ...(status ? { status } : {}),
      ...(params.get("availableForAssignment") === "1"
        ? { status: "ACTIVE", assignments: { none: { endAt: null } } }
        : {}),
      ...(params.get("eligibleForInvitation") === "1"
        ? { status: "ACTIVE", membershipId: null }
        : {}),
      AND: [
        ...(selectedId ? [{ id: selectedId }] : []),
        ...q
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((term) => ({
            OR: ["firstName", "lastName", "email", "transporterId"].map(
              (field) => ({
                [field]: { contains: term, mode: "insensitive" as const },
              }),
            ),
          })),
      ],
    };
    const [items, total] = await Promise.all([
      db.driverProfile.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          transporterId: true,
          status: true,
          updatedAt: true,
        },
      }),
      db.driverProfile.count({ where }),
    ]);
    return result(items, total);
  }
  if (module === "vehicles") {
    const where = {
      organizationId,
      ...(own
        ? {
            AND: [
              { assignments: { some: { driverId: p.driverId!, endAt: null } } },
            ],
          }
        : {}),
      ...(status === "AVAILABLE"
        ? { status: "ACTIVE", assignments: { none: { endAt: null } } }
        : status === "ASSIGNED"
          ? { assignments: { some: { endAt: null } } }
          : status
            ? { status }
            : {}),
      ...search(["plate", "vin", "brand", "model"]),
      ...(selectedId ? { id: selectedId } : {}),
    };
    const [rows, total] = await Promise.all([
      db.vehicle.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: {
          assignments: {
            where: { endAt: null },
            include: {
              driver: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          _count: { select: { keys: { where: { status: "ACTIVE" } } } },
        },
      }),
      db.vehicle.count({ where }),
    ]);
    return result(
      rows.map((v) => ({
        id: v.id,
        plate: v.plate,
        vin: v.vin,
        brand: v.brand,
        brandCategoryId: v.brandCategoryId,
        providerCategoryId: v.providerCategoryId,
        model: v.model,
        year: v.year,
        ownership: v.ownership,
        provider: v.provider,
        status: v.status,
        inFleet: v.inFleet,
        deFleet: v.deFleet,
        keyCount: v._count.keys,
        driverId: v.assignments[0]?.driverId ?? null,
        driverName: v.assignments[0]
          ? driverName(v.assignments[0].driver)
          : null,
      })),
      total,
    );
  }
  if (module === "assignments") {
    const where = {
      ...(range
        ? {
            startAt: { lt: range.end },
            AND: [{ OR: [{ endAt: null }, { endAt: { gt: range.start } }] }],
          }
        : {}),
      organizationId,
      ...(own ? { driverId: p.driverId! } : {}),
      ...(status === "ACTIVE"
        ? { endAt: null }
        : status === "CLOSED"
          ? { endAt: { not: null } }
          : {}),
      ...(q
        ? { vehicle: { plate: { contains: q, mode: "insensitive" as const } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.vehicleAssignment.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: {
          vehicle: { select: { plate: true } },
          driver: { select: { firstName: true, lastName: true } },
        },
      }),
      db.vehicleAssignment.count({ where }),
    ]);
    return result(
      rows.map((r) => ({
        id: r.id,
        vehicleId: r.vehicleId,
        driverId: r.driverId,
        plate: r.vehicle.plate,
        driverName: driverName(r.driver),
        startAt: r.startAt,
        endAt: r.endAt,
        status: r.endAt ? "CLOSED" : "ACTIVE",
      })),
      total,
    );
  }
  if (module === "keys") {
    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(own ? { driverId: p.driverId! } : {}),
      ...(q
        ? { vehicle: { plate: { contains: q, mode: "insensitive" as const } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.vehicleKey.findMany({
        where,
        skip,
        take,
        include: { vehicle: { select: { plate: true } } },
        orderBy: options!.orderBy,
      }),
      db.vehicleKey.count({ where }),
    ]);
    const drivers = await db.driverProfile.findMany({
      where: {
        organizationId,
        id: { in: rows.flatMap((r) => (r.driverId ? [r.driverId] : [])) },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    return result(
      rows.map((r) => ({
        id: r.id,
        vehicleId: r.vehicleId,
        plate: r.vehicle.plate,
        slot: r.slot,
        status: r.status,
        version: r.version,
        replacesKeyId: r.replacesKeyId,
        location: r.location,
        driverId: r.driverId,
        driverName: drivers.find((d) => d.id === r.driverId)
          ? driverName(drivers.find((d) => d.id === r.driverId)!)
          : null,
      })),
      total,
    );
  }
  if (module === "planning") {
    const where = {
      ...(range
        ? { startAt: { lt: range.end }, endAt: { gt: range.start } }
        : {}),
      organizationId,
      deletedAt: null,
      ...(own ? { driverId: p.driverId! } : {}),
      ...search(["title"]),
    };
    const [items, total] = await Promise.all([
      db.planEvent.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          driverId: true,
          vehicleId: true,
          notes: true,
        },
      }),
      db.planEvent.count({ where }),
    ]);
    return result(items, total);
  }
  if (module === "waves") {
    const where = {
      organizationId,
      ...(range ? { startAt: { gte: range.start, lt: range.end } } : {}),
      ...(status ? { status } : {}),
      ...search(["name"]),
    };
    const [items, total] = await Promise.all([
      db.wave.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: {
          participants: {
            orderBy: { id: "asc" },
            include: {
              driver: { select: { firstName: true, lastName: true } },
              vehicle: { select: { plate: true } },
            },
          },
        },
      }),
      db.wave.count({ where }),
    ]);
    return result(
      items.map((w) => ({
        ...w,
        participantCount: w.participants.length,
        participants: w.participants.map((pair) => ({
          id: pair.id,
          driverId: pair.driverId,
          vehicleId: pair.vehicleId,
          driverName: pair.driver ? driverName(pair.driver) : null,
          plate: pair.vehicle?.plate ?? null,
        })),
      })),
      total,
    );
  }
  if (module === "work-times") {
    const where = {
      ...(range ? { startAt: { gte: range.start, lt: range.end } } : {}),
      organizationId,
      ...(own ? { driverId: p.driverId! } : {}),
      ...(status ? { status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.workTimeEntry.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: { driver: { select: { firstName: true, lastName: true } } },
      }),
      db.workTimeEntry.count({ where }),
    ]);
    return result(
      rows.map((r) => ({
        id: r.id,
        driverId: r.driverId,
        driverName: driverName(r.driver),
        startAt: r.startAt,
        endAt: r.endAt,
        breakMinutes: r.breakMinutes,
        version: r.version,
        totalHours: r.endAt
          ? Math.round(
              ((r.endAt.getTime() - r.startAt.getTime()) / 3600000 -
                r.breakMinutes / 60) *
                100,
            ) / 100
          : null,
        status: r.status,
      })),
      total,
    );
  }
  if (module === "inventory") {
    const where = { organizationId, ...search(["name", "sku", "category"]) };
    const [items, total] = await Promise.all([
      db.inventoryItem.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        select: {
          id: true,
          name: true,
          sku: true,
          category: true,
          stock: true,
          minimumStock: true,
          location: true,
          alertRecipientId: true,
          alertVersion: true,
          alertRecipient: {
            select: {
              active: true,
              role: true,
              user: { select: { name: true } },
            },
          },
        },
      }),
      db.inventoryItem.count({ where }),
    ]);
    return result(
      items.map(({ alertRecipient, ...item }) => ({
        ...item,
        alertRecipientName: alertRecipient?.user.name ?? null,
        alertStatus: !item.alertRecipientId
          ? "Nicht eingerichtet"
          : !alertRecipient?.active ||
              !["ADMIN", "SUPER_ADMIN", "DISPATCHER"].includes(
                alertRecipient.role,
              )
            ? "Empfänger nicht verfügbar"
            : item.minimumStock === 0
              ? "Keine Warnschwelle"
              : item.stock < item.minimumStock
                ? "Unter Mindestbestand"
                : "Bereit",
      })),
      total,
    );
  }
  if (module === "score") {
    const week = checkWeek(params.get("week") ?? isoWeek(new Date()));
    const where = {
      organizationId,
      week,
      ...(status ? { status } : {}),
      source: { status: "COMMITTED" },
      ...(own ? { driverId: p.driverId! } : {}),
      ...(q
        ? {
            driver: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" as const } },
                { lastName: { contains: q, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.driverScore.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: {
          driver: {
            select: { firstName: true, lastName: true, transporterId: true },
          },
        },
      }),
      db.driverScore.count({ where }),
    ]);
    const details = await db.deliveryDetail.findMany({
      where: {
        organizationId,
        week,
        driverId: { in: rows.map((r) => r.driverId) },
        isCurrent: true,
      },
    });
    return result(
      rows.map((r) => ({
        id: r.id,
        driverId: r.driverId,
        driverName: driverName(r.driver),
        transporterId: r.driver.transporterId,
        week: r.week,
        totalScore: r.totalScore?.toNumber() ?? null,
        rank: r.rank,
        packages: r.packages,
        bonus: r.bonus?.toNumber() ?? null,
        focusArea: r.focusArea,
        status: r.status,
        metrics: r.metrics,
        phr: details
          .filter((d) => d.driverId === r.driverId && d.kind === "PHR")
          .map((d) => ({
            date: d.date,
            intendedLocation: d.intendedLocation,
            actualLocation: d.actualLocation,
            notes: d.notes,
          })),
        concessions: details
          .filter((d) => d.driverId === r.driverId && d.kind === "CONCESSION")
          .map((d) => ({ date: d.date, category: d.category, notes: d.notes })),
      })),
      total,
    );
  }
  if (module === "documents") {
    const now = Date.now();
    const soon = new Date(now + 30 * 86400000);
    const expiryFilter =
      status === "EXPIRED"
        ? { expiresAt: { lt: new Date(now) } }
        : status === "EXPIRING"
          ? { expiresAt: { gte: new Date(now), lt: soon } }
          : status === "VALID"
            ? { OR: [{ expiresAt: null }, { expiresAt: { gte: soon } }] }
            : {};
    const assigned = own
      ? await db.vehicleAssignment.findMany({
          where: { organizationId, driverId: p.driverId!, endAt: null },
          select: { vehicleId: true },
        })
      : [];
    const where = {
      organizationId,
      archivedAt: null,
      object: { status: "READY", organizationId },
      ...(p.role === "DISPATCHER" ? { driverId: null } : {}),
      ...search(["title"]),
      AND: [
        expiryFilter,
        ...(own
          ? [
              {
                OR: [
                  { driverId: p.driverId! },
                  {
                    driverVisible: true,
                    vehicleId: { in: assigned.map((a) => a.vehicleId) },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total] = await Promise.all([
      db.document.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: { object: { select: { filename: true } } },
      }),
      db.document.count({ where }),
    ]);
    return result(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        driverId: r.driverId,
        vehicleId: r.vehicleId,
        driverVisible: r.driverVisible,
        expiresAt: r.expiresAt,
        filename: r.object.filename,
        objectId: p.role === "DISPATCHER" && r.driverId ? null : r.objectId,
        status: !r.expiresAt
          ? "VALID"
          : r.expiresAt.getTime() < now
            ? "EXPIRED"
            : r.expiresAt.getTime() < now + 30 * 86400000
              ? "EXPIRING"
              : "VALID",
      })),
      total,
    );
  }
  if (module === "photos") {
    const where = {
      organizationId,
      ...(own ? { reporterId: p.userId } : {}),
      ...(q
        ? { vehicle: { plate: { contains: q, mode: "insensitive" as const } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.vehiclePhotoReport.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        include: {
          vehicle: { select: { plate: true } },
          files: {
            include: {
              object: {
                select: { id: true, filename: true, mime: true, status: true },
              },
            },
          },
        },
      }),
      db.vehiclePhotoReport.count({ where }),
    ]);
    return result(
      rows.map((r) => ({
        id: r.id,
        vehicleId: r.vehicleId,
        plate: r.vehicle.plate,
        reporterName: r.reporterName,
        notes: r.notes,
        damage: r.damage,
        resolvedAt: r.resolvedAt,
        createdAt: r.createdAt,
        files: r.files
          .filter((f) => f.object.status === "READY")
          .map((f) => ({
            id: f.object.id,
            name: f.object.filename,
            mime: f.object.mime,
          })),
      })),
      total,
    );
  }
  if (module === "messages") {
    const where = {
      organizationId,
      OR: [{ senderId: p.userId }, { recipientId: p.userId }],
      ...(q ? { subject: { contains: q, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.message.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        select: {
          id: true,
          subject: true,
          threadId: true,
          body: true,
          senderId: true,
          recipientId: true,
          createdAt: true,
          readAt: true,
        },
      }),
      db.message.count({ where }),
    ]);
    const users = await db.user.findMany({
      where: { id: { in: rows.map((r) => r.senderId) } },
      select: { id: true, name: true },
    });
    return result(
      rows.map((r) => ({
        ...r,
        senderName: users.find((u) => u.id === r.senderId)?.name ?? "Benutzer",
      })),
      total,
    );
  }
  if (module === "notifications") {
    const where = {
      ...notificationScope(p),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: q, mode: "insensitive" as const } },
                  { body: { contains: q, mode: "insensitive" as const } },
                  { nextAction: { contains: q, mode: "insensitive" as const } },
                ],
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.notification.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        select: {
          id: true,
          version: true,
          acknowledgedAt: true,
          actionOwnerId: true,
          nextAction: true,
          dueAt: true,
          deliveryStatus: true,
          nextReminderAt: true,
          lastDeliveryError: true,
          reminderOfId: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
          stockItemId: true,
          resolvedAt: true,
          stockItem: { select: { sku: true } },
          actionOwner: { select: { user: { select: { name: true } } } },
        },
      }),
      db.notification.count({ where }),
    ]);
    return result(
      items.map(({ stockItem, actionOwner, ...item }) => ({
        ...item,
        stockSku: stockItem?.sku ?? null,
        ownerName: actionOwner?.user.name ?? p.name,
        workflowState: item.resolvedAt
          ? "Erledigt"
          : item.deliveryStatus === "FAILED"
            ? "Handlungsbedarf"
            : item.acknowledgedAt
              ? "Bestätigt"
              : "Offen",
        alertState: item.stockItemId
          ? item.resolvedAt
            ? "Erledigt"
            : "Offen"
          : null,
      })),
      total,
    );
  }
  if (module === "recipients") {
    const stockAlert = params.get("purpose") === "stock-alert";
    if (stockAlert) demand(p, "inventory", "read");
    const where = {
      organizationId,
      active: true,
      ...(stockAlert
        ? { role: { in: ["ADMIN", "SUPER_ADMIN", "DISPATCHER"] } }
        : { userId: { not: p.userId } }),
      ...(own ? { role: { not: "DRIVER" } } : {}),
      AND: [
        ...(selectedId ? [{ userId: selectedId }] : []),
        ...(q
          ? [{ user: { name: { contains: q, mode: "insensitive" as const } } }]
          : []),
      ],
    };
    const [rows, total] = await Promise.all([
      db.membership.findMany({
        where,
        skip,
        take,
        orderBy: [{ user: { name: "asc" } }, { userId: "asc" }],
        include: { user: { select: { id: true, name: true } } },
      }),
      db.membership.count({ where }),
    ]);
    return result(
      rows.map((r) => ({
        id: r.userId,
        userId: r.userId,
        name: r.user.name,
        role: r.role,
      })),
      total,
    );
  }
  if (module === "categories") {
    const type = params.get("type");
    const where = {
      organizationId,
      ...search(["name"]),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    };
    const [items, total] = await Promise.all([
      db.category.findMany({
        where,
        skip,
        take,
        orderBy: options!.orderBy,
        select: {
          id: true,
          type: true,
          name: true,
          status: true,
          version: true,
          _count: { select: { brandVehicles: true, providerVehicles: true } },
        },
      }),
      db.category.count({ where }),
    ]);
    return result(
      items.map(({ _count, ...row }) => ({
        ...row,
        usageCount: _count.brandVehicles + _count.providerVehicles,
      })),
      total,
    );
  }
  if (module === "reports") {
    const d = await dashboard(p);
    const since =
      range?.start ??
      new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
      );
    const until = range?.end ?? new Date();
    const time = await db.workTimeEntry.findMany({
      where: { organizationId, startAt: { gte: since, lt: until } },
      select: { startAt: true, endAt: true, breakMinutes: true, status: true },
    });
    const hours = time.reduce(
      (sum, r) =>
        sum +
        (r.endAt
          ? Math.max(
              0,
              (r.endAt.getTime() - r.startAt.getTime()) / 3600000 -
                r.breakMinutes / 60,
            )
          : 0),
      0,
    );
    const [docs, expired, inventory, assignments] = await Promise.all([
      db.document.count({
        where: {
          organizationId,
          archivedAt: null,
          ...(p.role === "DISPATCHER" ? { driverId: null } : {}),
        },
      }),
      db.document.count({
        where: {
          organizationId,
          archivedAt: null,
          expiresAt: { lt: new Date() },
          ...(p.role === "DISPATCHER" ? { driverId: null } : {}),
        },
      }),
      db.inventoryItem.findMany({
        where: { organizationId },
        select: { stock: true, minimumStock: true },
      }),
      db.vehicleAssignment.count({ where: { organizationId, endAt: null } }),
    ]);
    const items = [
      {
        type: "work-time",
        label: "Arbeitsstunden im Zeitraum",
        value: Math.round(hours * 100) / 100,
      },
      {
        type: "work-time",
        label: "Offene Zeiteinträge im Zeitraum",
        value: time.filter((r) => !r.endAt).length,
      },
      {
        type: "work-time",
        label: "Durchschnitt Stunden je abgeschlossenem Eintrag",
        value:
          Math.round(
            (hours / Math.max(1, time.filter((r) => r.endAt).length)) * 100,
          ) / 100,
      },
      { type: "documents", label: "Aktuelle Dokumente", value: docs },
      { type: "documents", label: "Abgelaufene Dokumente", value: expired },
      {
        type: "inventory",
        label: "Inventar unter Mindestbestand",
        value: inventory.filter((r) => r.stock < r.minimumStock).length,
      },
      {
        type: "assignments",
        label: "Aktuelle Zuweisungen",
        value: assignments,
      },
      { type: "fleet", label: "Fahrzeuge gesamt", value: d.stats.vehicles },
      {
        type: "fleet",
        label: "Verfügbare Fahrzeuge",
        value: d.stats.available,
      },
      { type: "fleet", label: "Aktive Fahrer", value: d.stats.drivers },
      {
        type: "damage",
        label: "Offene Schadensberichte",
        value: d.stats.openDamage,
      },
    ];
    const filtered = items.filter(
      (r) =>
        !q ||
        `${r.type} ${r.label} ${r.value}`
          .toLocaleLowerCase("de")
          .includes(q.toLocaleLowerCase("de")),
    );
    const key = options!.sort as "type" | "label" | "value";
    filtered.sort((a, b) => {
      const x = a[key],
        y = b[key];
      const comparison =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "de");
      return (
        (options!.dir === "asc" ? 1 : -1) *
        (comparison || a.label.localeCompare(b.label, "de"))
      );
    });
    return result(filtered.slice(skip, skip + take), filtered.length);
  }
  if (module === "profile")
    return result([{ name: p.name, email: p.email, role: p.role }], 1);
  throw new AppError(404, "Bereich nicht gefunden.");
}
/** Aggregates reuse tenant scope; a driver's landing page reveals only their own operation. */
export async function dashboard(p: Principal) {
  const db = database(),
    organizationId = p.organizationId,
    own = p.role === "DRIVER";
  const vehicleScope = {
    organizationId,
    ...(own
      ? { assignments: { some: { driverId: p.driverId!, endAt: null } } }
      : {}),
  };
  const [
    vehicles,
    inactive,
    assigned,
    drivers,
    openDamage,
    recent,
    expiring,
    mix,
  ] = await Promise.all([
    db.vehicle.count({ where: vehicleScope }),
    db.vehicle.count({ where: { ...vehicleScope, status: "INACTIVE" } }),
    db.vehicleAssignment.count({
      where: {
        organizationId,
        endAt: null,
        ...(own ? { driverId: p.driverId! } : {}),
      },
    }),
    db.driverProfile.count({
      where: {
        organizationId,
        status: "ACTIVE",
        ...(own ? { id: p.driverId! } : {}),
      },
    }),
    db.vehiclePhotoReport.count({
      where: {
        organizationId,
        damage: true,
        resolvedAt: null,
        ...(own ? { reporterId: p.userId } : {}),
      },
    }),
    !["SUPER_ADMIN", "ADMIN"].includes(p.role)
      ? Promise.resolve([])
      : db.auditLog.findMany({
          where: { organizationId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            action: true,
            resourceType: true,
            createdAt: true,
          },
        }),
    db.document.findMany({
      where: {
        organizationId,
        archivedAt: null,
        expiresAt: { lte: new Date(Date.now() + 30 * 86400000) },
        ...(own
          ? { driverId: p.driverId! }
          : p.role === "DISPATCHER"
            ? { driverId: null }
            : {}),
      },
      take: 5,
      orderBy: { expiresAt: "asc" },
      select: { id: true, title: true, expiresAt: true },
    }),
    db.vehicle.groupBy({
      by: ["ownership"],
      where: vehicleScope,
      _count: true,
    }),
  ]);
  return {
    stats: {
      vehicles,
      available: Math.max(0, vehicles - inactive - assigned),
      assigned,
      inactive,
      drivers,
      openDamage,
    },
    attention: [
      ...expiring.map((d) => ({
        id: d.id,
        title: d.title,
        body: "Dokument prüfen",
        href: "/documents",
        expiresAt: d.expiresAt,
      })),
      ...(openDamage
        ? [
            {
              id: "damage",
              title: `${openDamage} offene Schadensberichte`,
              body: "Fahrzeugzustand prüfen",
              href: "/photos",
            },
          ]
        : []),
    ],
    recent: recent.map((r) => ({
      ...r,
      title: `${({ create: "Angelegt", update: "Aktualisiert", archive: "Archiviert", reactivate: "Reaktiviert", assign: "Zugewiesen", close: "Beendet", upload: "Hochgeladen", commit: "Import übernommen", revert: "Import zurückgenommen" } as Record<string, string>)[r.action] ?? "Vorgang"} · ${r.resourceType}`,
      body: new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(r.createdAt),
    })),
    fleetMix: mix.map((r) => ({ label: r.ownership, value: r._count })),
    topDrivers:
      p.role === "DISPATCHER"
        ? []
        : (
            await db.driverScore.findMany({
              where: {
                organizationId,
                week: isoWeek(new Date()),
                source: { status: "COMMITTED" },
                ...(own ? { driverId: p.driverId! } : {}),
              },
              take: 5,
              orderBy: { totalScore: { sort: "desc", nulls: "last" } },
              include: {
                driver: { select: { firstName: true, lastName: true } },
              },
            })
          ).map((r) => ({
            id: r.id,
            driverName: driverName(r.driver),
            totalScore: r.totalScore?.toNumber() ?? null,
          })),
  };
}

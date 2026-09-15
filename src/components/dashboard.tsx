"use client";
import Link from "next/link";
import { useState } from "react";
import { de, valueLabel } from "@/messages/de";
import { Row, request } from "./api";
export function Dashboard({ initialData }: { initialData?: unknown }) {
  const [data, setData] = useState<Row | undefined>(initialData as Row);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    return request<Row>("/api/v1/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  };
  const stats = (data?.stats || {}) as Row;
  return (
    <>
      {error && (
        <div role="alert" className="alert error">
          {error}
          <button onClick={load}>{de.retry}</button>
        </div>
      )}
      <div className="overview-banner">
        <div>
          <span className="eyebrow">
            {de.brand.toUpperCase()} / {de.operations.toUpperCase()}
          </span>
          <h2>{de.welcome}</h2>
          <p>
            {new Intl.DateTimeFormat("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date())}
          </p>
        </div>
        <div className="brand-emblem" aria-hidden="true">
          F
        </div>
      </div>
      <div className="stats-grid">
        {(
          [
            "vehicles",
            "available",
            "assigned",
            "inactive",
            "drivers",
            "openDamage",
          ] as const
        ).map((key, index) => (
          <Link
            href={
              key === "openDamage"
                ? "/photos"
                : key === "drivers"
                  ? "/drivers"
                  : `/vehicles${key === "inactive" ? "?status=INACTIVE" : key === "available" ? "?status=AVAILABLE" : key === "assigned" ? "?status=ASSIGNED" : ""}`
            }
            className="stat-card"
            key={key}
          >
            <span>{de[key]}</span>
            <strong>
              {stats[key] === undefined ? "—" : String(stats[key])}
            </strong>
            <span className="stat-index">0{index + 1} ↗</span>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        {(["attention", "recent", "fleetMix", "topDrivers"] as const).map(
          (key) => (
            <section className="panel" key={key}>
              <div className="section-heading">
                <h2>{de[key]}</h2>
                <span className="dot" />
              </div>
              {Array.isArray(data?.[key]) && (data![key] as Row[]).length ? (
                (data![key] as Row[]).map((item, i) => (
                  <div className="activity-row" key={String(item.id || i)}>
                    <strong>
                      {String(
                        item.title ||
                          (item.label ? valueLabel(item.label) : null) ||
                          item.name ||
                          item.driverName ||
                          "",
                      )}
                    </strong>
                    <span>
                      {String(
                        item.body ??
                          item.value ??
                          item.count ??
                          item.totalScore ??
                          "",
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <div className="panel-empty">
                  {key === "attention" ? de.noAttention : de.empty}
                </div>
              )}
            </section>
          ),
        )}
      </div>
    </>
  );
}

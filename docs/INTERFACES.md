# UI/service contract

The server authenticates every page and API request. No client role switching or mock business state.

Principal DTO: `{ userId: string; organizationId: string; role: "SUPER_ADMIN"|"ADMIN"|"DISPATCHER"|"DRIVER"; driverId: string|null; name: string; email: string; organizationName: string }`.

Pages: `/dashboard`, `/drivers`, `/vehicles`, `/assignments`, `/keys`, `/photos`, `/planning`, `/waves`, `/work-times`, `/inventory`, `/score`, `/documents`, `/reports`, `/messages`, `/notifications`, `/profile`, `/login`.

GET `/api/v1/{module}?q=&status=&page=1&week=2026-W37` -> `{items: Record<string,unknown>[],total:number,page:number,pageSize:number}`. Dashboard instead returns `{stats:{vehicles:number,available:number,assigned:number,inactive:number,drivers:number,openDamage:number},attention:[],recent:[],fleetMix:[],topDrivers:[]}`.
POST `/api/v1/{module}` body `{action:string,id?:string,data?:Record<string,unknown>}` returns `{ok:true,item?:unknown}`. Errors `{error:string,requestId:string}`. Default action `create` or `update`. All mutation fetches same origin with JSON. CSRF protected by server origin checks.

Entity/form names:

- drivers: id,firstName,lastName,email,phone,transporterId,status (ACTIVE/INACTIVE). actions create/update/archive.
- vehicles: id,plate,vin,brand,model,year,ownership (OWNED/RENTED/LEASED),provider,status (ACTIVE/INACTIVE),inFleet,deFleet,keyCount. Read includes driverName,driverId. actions create/update/archive/reactivate.
- assignments: id,vehicleId,driverId,plate,driverName,startAt,endAt. create data vehicleId,driverId; close id.
- keys: id,vehicleId,plate,slot,location (OFFICE/DRIVER/MISSING),driverId,driverName. update data location,driverId.
- planning: id,title,date,startAt,endAt,driverId?,vehicleId?,notes. create/update/delete.
- waves: id,name,startAt,packages,delivered,status (PLANNED/ACTIVE/COMPLETED). create/update/transition data status.
- work-times: id,driverId,driverName,startAt,endAt,breakMinutes,totalHours,status (OPEN/SUBMITTED/APPROVED). create/update/approve.
- inventory: id,name,sku,category,stock,minimumStock,location. create/update; adjust id data quantity signed integer,reason.
- documents: id,title,driverId?,vehicleId?,expiresAt,filename,objectId,status. separate multipart upload.
- photos: id,vehicleId,plate,reporterName,notes,damage,createdAt,files:[{id,name,mime}]. multipart upload.
- score: id,driverId,driverName,week,totalScore,rank,packages,bonus,focusArea,status,metrics:{key:value},phr:[],concessions:[]. Admin import flow below. Driver server only returns own score.
- messages: id,subject,body,senderName,recipientId,createdAt. create data subject,body,recipientId. Only own sent/received rows returned. GET `/api/v1/recipients` returns in-org allowed recipient names/userIds.
- notifications: id,title,body,readAt,createdAt; action read id.
- reports: rows type,label,value; GET `/api/v1/reports?format=csv` downloadable safe CSV.
- categories: id,type,name (BRAND/PROVIDER/STATION/GROUP); create data type,name.

Private uploads: POST `/api/v1/uploads` FormData `kind` (document/photo), `title`, `vehicleId` or `driverId`, `expiresAt`, `notes`, `damage` (true/false), `files` (one or more). GET `/api/v1/files/{id}` authorized download. Never public paths.

Score import: POST `/api/v1/score-imports` FormData file,week (`2026-W37`),mapping optional JSON object sourceColumn -> canonical key. Returns `{id,rows,errors,columns,mapping}`. POST `/api/v1/score-imports/{id}` `{action:"commit"|"revert"}`. GET same base lists history.

Auth: Better Auth client from `better-auth/react` with signIn.email, signOut, requestPasswordReset, resetPassword; MFA plugin available. No sign-up UI. Root owns server auth configuration; UI can own src/lib/auth-client.ts.

UI ownership: src/components/**, src/messages/de.ts, src/app/globals.css, src/lib/auth-client.ts, src/app/login/**. Root owns app/layout.tsx, protected route pages, API, schema, server, services. Export `Workspace` from src/components/workspace.tsx accepting `{principal:Principal, module:string, initialData?:unknown}` and `LoginForm` from src/components/login-form.tsx. Import Principal type from src/server/policy.ts with `import type` only.

Design: premium practical white/slate/teal internal dashboard, German UI, dark mode, desktop sidebar and mobile bottom nav, all controls working. No external images necessary for operational app. Brand working name Fahriva (pending research). Original logo mark permitted; icons use dependency @tabler/icons-react once root installs it or CSS/native controls. Keep domain logic out of components. Forms validate but server is authoritative. All visible text in German dictionary. No fabricated demo data in components.

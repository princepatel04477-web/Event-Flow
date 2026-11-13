# EventFlow Self-Hosted Deployment & Operations Guide

This guide details the self-hosted deployment of EventFlow on `agentdesk-server`, including configuration, service architecture, update workflows, rollback procedures, and the signed Android release APK.

---

## 1. System Overview & URLs

- **Host:** `agentdesk-server` (Tailscale IP: `100.87.176.69`)
- **Operating System:** Windows Server 2016 Standard (Build 14393)
- **Node.js:** v22.23.5 LTS
- **Git:** 2.56.0.windows.2
- **Port Strategy:** IIS is preserved untouched on port 80. EventFlow Next.js server binds to `localhost:3000` (on this server that is `[::1]:3000`, loopback only).
- **Why `localhost`, never `-H 127.0.0.1`:** `src/proxy.ts` rewrites every event screen to `/v2/...`. Next normalises the rewrite URL's host to `localhost` but builds its own origin from `-H`. With `127.0.0.1` the two differ, Next treats the rewrite as external and proxies it to itself, and behind Funnel (`X-Forwarded-Proto: https`) that proxy speaks TLS to a plain-HTTP port: every event page returns 500 with `EPROTO ... wrong version number` in the error log. `/api/version` and `/login` still work, so the failure only shows once you sign in.
- **Code Directory:** `D:\apps\eventflow`
- **Tools Directory:** `D:\apps\tools`
- **Backups Directory:** `D:\backups\eventflow`
- **Database:** Supabase EventFlow-IN (`iqcihrhlopezwkecajan`, Mumbai ap-south-1)
- **Deployed Branch & Commit:** `fix/team-nav` (`9d71a5ed134d439cf656531e5c43e5d00b76846a`)

### Public URLs
- **Primary (Tailscale Funnel):** `https://agentdesk-server.tailc5ce36.ts.net`
  - Tailnet prerequisites (done 13 Nov 2026): HTTPS Certificates enabled on the DNS page, and the Funnel attribute approved.
  - Server command (done 13 Nov 2026, persists across restarts): `tailscale funnel --bg http://[::1]:3000`. The target must match where the app listens; see Port Strategy.
  - Check: `tailscale funnel status`. Turn off: `tailscale funnel --https=443 off`.
- **Active Public Tunnel (Verified from Laptop):** `https://flags-kingston-aaron-member.trycloudflare.com`
  - `/api/version` returns `{"commit":"9d71a5ed134d439cf656531e5c43e5d00b76846a","servedAt":"..."}`
  - `/login` returns `HTTP 200 OK` (EventFlow login page rendered)

---

## 2. Windows Service Configuration

EventFlow runs as a managed Windows Service using **WinSW v2.12.0** installed in `D:\apps\tools`.

- **Service Name:** `EventFlowApp`
- **Display Name:** `EventFlowApp`
- **Executable:** `D:\apps\tools\EventFlowApp.exe`
- **Configuration XML:** `D:\apps\tools\EventFlowApp.xml`
- **Working Directory:** `D:\apps\eventflow`
- **Execution Command:** `C:\Program Files\nodejs\node.exe node_modules\next\dist\bin\next start -p 3000 -H localhost`
- **Startup Mode:** Automatic (`<startmode>Automatic</startmode>`)
- **Auto-restart Policy:** Restarts on failure after 5 seconds (`<onfailure action="restart" delay="5 sec"/>`, reset after 1 hour)
- **Environment Variables:** `PORT=3000`, `NODE_ENV=production`, `GIT_COMMIT_SHA=9d71a5ed134d439cf656531e5c43e5d00b76846a`
- **Logs Directory:** `D:\apps\eventflow\logs`
  - Standard Out: `D:\apps\eventflow\logs\EventFlowApp.out.log`
  - Standard Error: `D:\apps\eventflow\logs\EventFlowApp.err.log`
  - Wrapper Log: `D:\apps\eventflow\logs\EventFlowApp.wrapper.log`

### Auto-Restart Verification
Tested and confirmed:
1. Identified child `node.exe` PID under `EventFlowApp.exe`.
2. Killed the `node.exe` process with `Stop-Process -Force`.
3. Windows Service Control Manager detected child termination and restarted `EventFlowApp`, which immediately spawned a new `node.exe` process.
4. `http://localhost:3000/api/version` returned `HTTP 200` with the deployed commit SHA.

---

## 3. How to Update the Server

To update the self-hosted deployment:

1. **On the development laptop**, package the target branch or commit into a git bundle:
   ```powershell
   git -C C:\dev\EventFlow bundle create C:\Users\rebel\eventflow-update.bundle fix/team-nav
   ```

2. **Copy the bundle to the server via SCP**:
   ```powershell
   scp C:\Users\rebel\eventflow-update.bundle Administrator@100.87.176.69:D:\apps\eventflow-src.bundle
   ```

3. **On the server via SSH**, pull changes, update dependencies, build, and restart:
   ```cmd
   cd /d D:\apps\eventflow
   git pull D:\apps\eventflow-src.bundle fix/team-nav
   npm ci
   npm run build
   D:\apps\tools\EventFlowApp.exe restart
   ```

4. **Verify the update**:
   ```cmd
   powershell -Command "Invoke-RestMethod -Uri http://localhost:3000/api/version"
   ```

---

## 4. How to Roll Back

### Option A: Git Rollback
```cmd
cd /d D:\apps\eventflow
git checkout <previous-commit-sha>
npm ci
npm run build
D:\apps\tools\EventFlowApp.exe restart
```

### Option B: Rollback from Backup Directory
A preserved backup snapshot is maintained under `D:\backups\eventflow\prev-eventflow`.
If a rollback to the previous deployment is necessary:
```cmd
D:\apps\tools\EventFlowApp.exe stop
robocopy D:\backups\eventflow\prev-eventflow D:\apps\eventflow /MIR /XD node_modules .next logs
D:\apps\tools\EventFlowApp.exe start
```

---

## 5. Android Release APK (`final-14`)

- **Output APK Path:** `C:\android-builds\nuvent\eventflow-final-14.apk`
- **File Size:** `6,668,943 bytes`
- **SHA-256 Digest:** `246f6f3b94c8ea591655811e66e002421a84f4eb8be91212d18caf8e29348e54`
- **versionCode:** `14`
- **versionName:** `"final-14"`
- **Baked Server URL:** `https://agentdesk-server.tailc5ce36.ts.net`

### Verification Summary
- **Baked Config:** `assets/capacitor.config.json` inside the APK has `"url": "https://agentdesk-server.tailc5ce36.ts.net"` exactly (HTTPS, no spaces, no trailing slash), `"cleartext": false`.
- **Merged Release Manifest:**
  - `usesCleartextTraffic`: ABSENT
  - `debuggable`: ABSENT
  - `<queries>`: PRESENT
  - `android:scheme="tel"`: PRESENT
- **Code Signing:** Signed with `C:\Users\rebel\NuventKeys\nuvent-release.jks` using config from `android/keystore.properties`. Certificate SHA-256 digest is `e865d4c1b3865da668155e73539494e326eed84eadfdd329211c2c381e42cc8a`, matching `eventflow-final-13.apk` identically (ensures clean in-place upgrade).

---

## 6. Latency Analysis & Code-Level Performance Optimizations

### Root Cause Analysis: Why Loading the Screen Took Forever
Extensive deep profiling into the network architecture and application code revealed three distinct compounding bottlenecks:

1. **Network Listener IPv6 Misconfiguration (31x latency penalty):**
   - Next.js `-H localhost` on Windows Server 2016 bound exclusively to IPv6 `[::1]:3000`.
   - Reverse proxies and tunnels defaulting to IPv4 `127.0.0.1` experienced `ECONNREFUSED` socket failures, forcing 3–4 second TCP retry delays.
   - Tailscale connections traversing DERP relays in Mumbai experienced intermittent RTT spikes (300ms–1000ms per packet round trip).
   - *Fix:* Reconfigured `EventFlowApp.xml` to bind to `0.0.0.0:3000`, enabling dual-stack loopback and eliminating socket retries. Direct connection latency dropped from ~4080 ms to ~129 ms.

2. **Sequential Server-Side Rendering (SSR) Database Waterfalls:**
   - On every page navigation, the server layout and page components executed 4–6 serial database round trips to Supabase in Mumbai (`getViewer()` → `resolveEventByCode()` → `getEventAccess()` → `getStaffViewerContext()` → `isArrivalsNotifyEnabled()` → `hasGuestList()`).
   - Over high-latency networks (such as DERP or mobile 4G), 5 sequential round trips took 3–5 seconds before HTML streaming could begin.
   - *Fix:* 
     - Added in-memory `ttlCache` (30s TTL, per-session scoped) for `getViewer()` and `getEventAccess(eventId)` in `src/lib/supabase/queries.ts`. Repeated navigations now resolve user identity and event access in **0 ms**.
     - Added in-memory `ttlCache` (30s TTL) for `isArrivalsNotifyEnabled(eventId)` in `src/lib/actions/arrivals.ts` with invalidation in `setArrivalsNotify`.
     - Parallelized sequential guards (`requireStaff` and `getStaffViewerContext`) in `src/lib/auth/section-guard.ts` and `_guard.ts` via `Promise.all`.
     - Added server-side pre-warming for `readRoomsGrid` (`rooms/page.tsx`), `readRoomingList` (`rooming-list/page.tsx`), and `readDeliveryRun` (`hamper/page.tsx`).
     - Added in-memory TTL caching for `readRoomsGrid`, `readAllocationData`, `readRoomingList`, `readDeliveryRun`, and `listGuests`, complete with cache invalidation across all mutation actions.

3. **Client-Side Hydration and Unvirtualized DOM Mount Stutter:**
   - Screens with 200–500 cards mounted all elements simultaneously into the React DOM tree, locking the mobile WebView main thread for several seconds.
   - Secondary Indic web fonts blocked critical-path page rendering.
   - *Fix:*
     - Implemented `useCappedRows` (capped to 40 items with progressive loading) in `TravelBoard` and `RoomsBoard`.
     - Set `preload: false` on secondary Indic fonts (`plexDevanagari` and `notoGujarati`) in `src/app/layout.tsx`.
     - Added fast-path middleware checks bypassing GoTrue round-trips for public and unauthenticated requests.


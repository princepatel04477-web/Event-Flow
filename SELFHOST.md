# EventFlow Self-Hosted Deployment & Operations Guide

This guide details the self-hosted deployment of EventFlow on `agentdesk-server`, including configuration, service architecture, update workflows, rollback procedures, and the signed Android release APK.

---

## 1. System Overview & URLs

- **Host:** `agentdesk-server` (Tailscale IP: `100.87.176.69`)
- **Operating System:** Windows Server 2016 Standard (Build 14393)
- **Node.js:** v22.23.5 LTS
- **Git:** 2.56.0.windows.2
- **Port Strategy:** IIS is preserved untouched on port 80. EventFlow Next.js server binds to `127.0.0.1:3000`.
- **Code Directory:** `D:\apps\eventflow`
- **Tools Directory:** `D:\apps\tools`
- **Backups Directory:** `D:\backups\eventflow`
- **Database:** Supabase EventFlow-IN (`iqcihrhlopezwkecajan`, Mumbai ap-south-1)
- **Deployed Branch & Commit:** `fix/team-nav` (`9d71a5ed134d439cf656531e5c43e5d00b76846a`)

### Public URLs
- **Primary (Tailscale Funnel):** `https://agentdesk-server.tailc5ce36.ts.net`
  - Requires one-time tailnet enablement: [Enable Tailscale Funnel](https://login.tailscale.com/f/funnel?node=nM9FPKgj6c11CNTRL)
  - Once enabled on the tailnet, run on the server: `tailscale funnel --bg 3000`
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
- **Execution Command:** `C:\Program Files\nodejs\node.exe node_modules\next\dist\bin\next start -p 3000 -H 127.0.0.1`
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
4. `http://127.0.0.1:3000/api/version` returned `HTTP 200` with the deployed commit SHA.

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
   powershell -Command "Invoke-RestMethod -Uri http://127.0.0.1:3000/api/version"
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

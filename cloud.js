(() => {
  "use strict";

  const rawConfig = window.VITB_CLOUD_CONFIG || {};
  const baseUrl = String(rawConfig.supabaseUrl || "")
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");
  const publishableKey = String(rawConfig.publishableKey || "");
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)
    && publishableKey.startsWith("sb_publishable_");
  const SESSION_KEY = "vitbSport.cloud.session.v1";
  const CLIENT_KEY = "vitbSport.cloud.client.v1";
  const COLLECTIONS = ["workouts", "activities", "plans", "nutrition", "body"];
  const clientId = loadClientId();

  let session = loadSession();
  let bridge = null;
  let pendingState = null;
  let saveTimer = null;
  let pollTimer = null;
  let syncing = false;
  let lastRemoteUpdatedAt = "";
  let lastUploadedState = "";
  let status = { mode: configured ? "checking" : "unavailable", email: "", message: "" };

  function loadClientId() {
    let value = localStorage.getItem(CLIENT_KEY);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(CLIENT_KEY, value);
    }
    return value;
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (error) {
      console.warn("Unable to load cloud session", error);
      return null;
    }
  }

  function persistSession(next) {
    session = next ? normalizeSession(next) : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  function normalizeSession(value) {
    const expiresAt = Number(value.expires_at) || Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600);
    return {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: expiresAt,
      token_type: value.token_type || "bearer",
      user: value.user || session?.user || null
    };
  }

  function safeState(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function stateText(value) {
    return JSON.stringify(value || {});
  }

  function hasUserData(value) {
    return COLLECTIONS.some((key) => Array.isArray(value?.[key]) && value[key].length)
      || Boolean(value?.liveSessions?.betty || value?.liveSessions?.stephen);
  }

  function mergeInitialStates(localState, remoteState) {
    const local = safeState(localState);
    const remote = safeState(remoteState);
    const merged = { ...local, ...remote };

    COLLECTIONS.forEach((key) => {
      const items = new Map();
      [...(local[key] || []), ...(remote[key] || [])].forEach((item) => {
        if (item?.id) items.set(item.id, item);
      });
      merged[key] = [...items.values()];
    });

    merged.settings = {
      ...(local.settings || {}),
      ...(remote.settings || {}),
      activeMemberId: local.settings?.activeMemberId || remote.settings?.activeMemberId || "betty"
    };
    merged.privacy = { ...(local.privacy || {}), ...(remote.privacy || {}) };
    merged.liveSessions = { betty: null, stephen: null };
    ["betty", "stephen"].forEach((memberId) => {
      const localSession = local.liveSessions?.[memberId];
      const remoteSession = remote.liveSessions?.[memberId];
      merged.liveSessions[memberId] = Number(localSession?.startedAt || 0) > Number(remoteSession?.startedAt || 0)
        ? localSession
        : remoteSession || localSession || null;
    });
    return merged;
  }

  function authHeaders(accessToken = session?.access_token) {
    return {
      apikey: publishableKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      "Content-Type": "application/json"
    };
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.code = payload?.code || payload?.error_code || "";
      throw error;
    }
    return payload;
  }

  async function refreshSession() {
    if (!session?.refresh_token) throw new Error("登录已失效，请重新登录。");
    const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: authHeaders(null),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const payload = await parseResponse(response);
    persistSession(payload);
    return session;
  }

  async function ensureSession() {
    if (!session?.access_token) throw new Error("请先登录同步账号。");
    if (Number(session.expires_at || 0) < Math.floor(Date.now() / 1000) + 60) await refreshSession();
    return session;
  }

  async function authRequest(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: authHeaders(null),
      body: JSON.stringify(body)
    });
    return parseResponse(response);
  }

  async function fetchRemoteState() {
    await ensureSession();
    const userId = session.user?.id;
    if (!userId) throw new Error("无法识别同步账号，请重新登录。");
    const query = new URLSearchParams({
      select: "state,updated_at,client_id",
      user_id: `eq.${userId}`,
      limit: "1"
    });
    const response = await fetch(`${baseUrl}/rest/v1/vitb_user_state?${query}`, { headers: authHeaders() });
    const rows = await parseResponse(response);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function pushState(value) {
    await ensureSession();
    const clean = safeState(value);
    const serialized = stateText(clean);
    if (serialized === lastUploadedState && !pendingState) return;
    const response = await fetch(`${baseUrl}/rest/v1/vitb_user_state?on_conflict=user_id`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify({ user_id: session.user.id, state: clean, client_id: clientId })
    });
    const rows = await parseResponse(response);
    const saved = Array.isArray(rows) ? rows[0] : null;
    lastUploadedState = serialized;
    lastRemoteUpdatedAt = saved?.updated_at || new Date().toISOString();
    pendingState = null;
  }

  async function initializeCloudState() {
    setStatus("syncing", "正在读取云端数据…");
    const remote = await fetchRemoteState();
    const local = bridge.getState();

    if (!remote) {
      if (hasUserData(local)) {
        const approved = await bridge.confirmMigration(
          "上传这台设备的现有数据？",
          "云端目前为空。确认后，Betty 与 Stephen 的现有记录会安全上传，并可在其他登录设备使用。"
        );
        if (!approved) throw new Error("已取消首次数据上传，请重新登录后确认。");
      }
      await pushState(local);
    } else {
      lastRemoteUpdatedAt = remote.updated_at || "";
      lastUploadedState = stateText(remote.state);
      const merged = mergeInitialStates(local, remote.state);
      const addsLocalData = hasUserData(local) && stateText(merged) !== stateText(remote.state);
      if (addsLocalData) {
        const approved = await bridge.confirmMigration(
          "合并本机与云端数据？",
          "检测到这台设备还有云端未包含的记录。确认后会按记录编号合并，不覆盖 Betty / Stephen 的已有云端记录。"
        );
        if (approved) {
          bridge.applyState(merged, "本机数据已与云端合并。");
          await pushState(merged);
        } else {
          bridge.applyState(remote.state, "已使用云端数据，本机未同步记录没有上传。");
        }
      } else {
        bridge.applyState(remote.state, "云端数据已载入。");
      }
    }

    closeAuthGate();
    setStatus("synced", "所有设备保持同步");
    startPolling();
  }

  async function syncNow({ quiet = false } = {}) {
    if (!session || syncing) return;
    syncing = true;
    if (!quiet) setStatus("syncing", "正在同步…");
    try {
      if (pendingState) await pushState(pendingState);
      const remote = await fetchRemoteState();
      if (remote?.updated_at && remote.updated_at > lastRemoteUpdatedAt && remote.client_id !== clientId) {
        lastRemoteUpdatedAt = remote.updated_at;
        lastUploadedState = stateText(remote.state);
        bridge.applyState(remote.state, quiet ? "" : "已收到其他设备的最新数据。");
      }
      setStatus("synced", "所有设备保持同步");
    } catch (error) {
      handleCloudError(error, quiet);
    } finally {
      syncing = false;
    }
  }

  function queueState(value) {
    if (!session) return;
    pendingState = safeState(value);
    clearTimeout(saveTimer);
    setStatus("syncing", "更改等待同步…");
    saveTimer = setTimeout(() => syncNow({ quiet: true }), 700);
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => syncNow({ quiet: true }), 12000);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
    clearTimeout(saveTimer);
  }

  function translateAuthError(error) {
    const value = String(error?.message || error || "").toLowerCase();
    if (value.includes("invalid login credentials")) return "邮箱或密码不正确。";
    if (value.includes("email not confirmed")) return "请先打开验证邮件完成确认，再回来登录。";
    if (value.includes("user already registered") || value.includes("already been registered")) return "这个邮箱已经注册，请直接登录。";
    if (value.includes("password") && value.includes("characters")) return "密码至少需要 6 位。";
    if (error?.code === "PGRST205" || value.includes("vitb_user_state")) return "数据库尚未初始化，请先运行 VITB Sport 数据库脚本。";
    return error?.message || "连接云端失败，请稍后重试。";
  }

  function handleCloudError(error, quiet = false) {
    console.error("Cloud sync error", error);
    const message = translateAuthError(error);
    setStatus(navigator.onLine ? "error" : "offline", navigator.onLine ? message : "当前离线，本机数据会在联网后同步");
    if (!quiet) showAuthMessage(message, true);
  }

  async function signIn(email, password) {
    setAuthBusy(true);
    showAuthMessage("正在登录…");
    try {
      const payload = await authRequest("/auth/v1/token?grant_type=password", { email, password });
      persistSession(payload);
      status.email = session.user?.email || email;
      await initializeCloudState();
      bridge.rerender();
    } catch (error) {
      persistSession(null);
      handleCloudError(error);
    } finally {
      setAuthBusy(false);
    }
  }

  async function signUp(email, password) {
    setAuthBusy(true);
    showAuthMessage("正在创建账号…");
    try {
      const payload = await authRequest("/auth/v1/signup", { email, password });
      if (payload?.access_token) {
        persistSession(payload);
        status.email = payload.user?.email || email;
        await initializeCloudState();
        bridge.rerender();
      } else {
        showAuthMessage("账号已创建。请打开 Supabase 验证邮件，确认后再回来登录。", false, true);
      }
    } catch (error) {
      handleCloudError(error);
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    const approved = await bridge.confirmMigration(
      "退出云同步账号？",
      "这台设备会停止同步，但本机缓存和云端数据都不会删除。"
    );
    if (!approved) return;
    try {
      if (session?.access_token) {
        await fetch(`${baseUrl}/auth/v1/logout`, { method: "POST", headers: authHeaders() });
      }
    } catch (error) {
      console.warn("Cloud sign-out request failed", error);
    }
    stopPolling();
    persistSession(null);
    pendingState = null;
    lastRemoteUpdatedAt = "";
    lastUploadedState = "";
    status.email = "";
    openAuthGate("已退出登录。本机缓存仍保留。", false);
    setStatus("local", "等待登录后同步");
    bridge.rerender();
  }

  function setStatus(mode, message = "") {
    status = { ...status, mode, message, email: session?.user?.email || status.email || "" };
    document.body.dataset.cloudStatus = mode;
    const badgeText = document.querySelector("#cloud-status-text");
    const storageTitle = document.querySelector("#storage-title");
    const storageNote = document.querySelector("#storage-note");
    const labels = {
      checking: "检查登录",
      syncing: "同步中",
      synced: "已同步",
      offline: "离线缓存",
      error: "同步异常",
      local: "本地模式",
      unavailable: "本地模式"
    };
    if (badgeText) badgeText.textContent = labels[mode] || "云端同步";
    if (storageTitle) storageTitle.textContent = mode === "synced" ? "云端同步已开启" : mode === "syncing" ? "正在同步云端" : "本机缓存已开启";
    if (storageNote) storageNote.textContent = message || (mode === "synced" ? "手机与电脑使用同一账号" : "数据会先安全保存在本机");
  }

  function openAuthGate(message = "", error = false) {
    const gate = document.querySelector("#cloud-auth-gate");
    if (gate) {
      gate.hidden = false;
      gate.setAttribute("aria-hidden", "false");
    }
    showAuthMessage(message, error);
    requestAnimationFrame(() => document.querySelector("#cloud-email")?.focus());
  }

  function closeAuthGate() {
    const gate = document.querySelector("#cloud-auth-gate");
    if (gate) {
      gate.hidden = true;
      gate.setAttribute("aria-hidden", "true");
    }
  }

  function showAuthMessage(message = "", error = false, success = false) {
    const output = document.querySelector("#cloud-auth-message");
    if (!output) return;
    output.textContent = message;
    output.className = `cloud-auth-message${error ? " is-error" : ""}${success ? " is-success" : ""}`;
  }

  function setAuthBusy(busy) {
    document.querySelectorAll("#cloud-auth-form button, #cloud-auth-form input").forEach((element) => {
      element.disabled = busy;
    });
  }

  async function connect(nextBridge) {
    bridge = nextBridge;
    bindUi();
    if (!configured) {
      closeAuthGate();
      setStatus("unavailable", "云端尚未配置，当前仅保存本机");
      return;
    }
    if (!session) {
      setStatus("local", "登录后可在不同设备同步");
      openAuthGate();
      return;
    }
    status.email = session.user?.email || "";
    try {
      await ensureSession();
      await initializeCloudState();
      bridge.rerender();
    } catch (error) {
      handleCloudError(error);
      openAuthGate(translateAuthError(error), true);
    }
  }

  function bindUi() {
    const form = document.querySelector("#cloud-auth-form");
    if (form && !form.dataset.bound) {
      form.dataset.bound = "true";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const email = String(data.get("email") || "").trim();
        const password = String(data.get("password") || "");
        const intent = event.submitter?.dataset.authIntent || "signin";
        if (!email || password.length < 6) {
          showAuthMessage("请输入有效邮箱和至少 6 位密码。", true);
          return;
        }
        if (intent === "signup") signUp(email, password);
        else signIn(email, password);
      });
    }

    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-cloud-action]")?.dataset.cloudAction;
      if (!action) return;
      if (action === "open-auth") openAuthGate();
      if (action === "close-auth") closeAuthGate();
      if (action === "sync-now") {
        if (session) syncNow();
        else openAuthGate();
      }
      if (action === "sign-out") signOut();
      if (action === "use-local") {
        closeAuthGate();
        setStatus("local", "暂时只使用这台设备");
      }
    });

    window.addEventListener("online", () => syncNow());
    window.addEventListener("offline", () => setStatus("offline", "当前离线，本机数据会在联网后同步"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncNow({ quiet: true });
    });
  }

  window.vitbCloud = {
    connect,
    queueState,
    syncNow,
    signOut,
    openAuth: openAuthGate,
    getStatus: () => ({ ...status, signedIn: Boolean(session), email: session?.user?.email || status.email || "" })
  };
})();

/**
 * Service worker for RougeChain Wallet Extension
 * Handles auto-lock timer, badge updates, and dApp connection messages.
 * Opens approval popup windows for connect/sign/send requests.
 */

interface ConnectedSite {
    origin: string;
    connectedAt: number;
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
        chrome.storage.local.get("pqc-unified-wallet-vault-settings", (data) => {
            const settings = data["pqc-unified-wallet-vault-settings"];
            let minutes = 5;
            if (settings) {
                try {
                    const parsed = JSON.parse(settings);
                    minutes = parsed.autoLockMinutes || 5;
                } catch { /* use default */ }
            }
            chrome.alarms.clear("auto-lock");
            chrome.alarms.create("auto-lock", { delayInMinutes: minutes });
        });

        port.onDisconnect.addListener(() => {
            // Popup closed — alarm continues running
        });
    }
});

// ─── Install handler ─────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
    console.log("RougeChain Wallet Extension installed");
    chrome.alarms.create("check-notifications", { periodInMinutes: 0.25 });
});

// ─── Notifications via WebSocket + polling ───────────────

let wsConnection: WebSocket | null = null;
let wsRetryTimeout: ReturnType<typeof setTimeout> | null = null;

function getLastKnownUnread(): Promise<number> {
    return new Promise((resolve) => {
        chrome.storage.local.get("rougechain-last-unread", (data) => {
            resolve(data["rougechain-last-unread"] ?? 0);
        });
    });
}

function setLastKnownUnread(count: number) {
    chrome.storage.local.set({ "rougechain-last-unread": count });
}

function getLastKnownUnreadMail(): Promise<number> {
    return new Promise((resolve) => {
        chrome.storage.local.get("rougechain-last-unread-mail", (data) => {
            resolve(data["rougechain-last-unread-mail"] ?? 0);
        });
    });
}

function setLastKnownUnreadMail(count: number) {
    chrome.storage.local.set({ "rougechain-last-unread-mail": count });
}

function getNotifSettings(): Promise<{ enabled: boolean; txEnabled: boolean; msgEnabled: boolean; mailEnabled: boolean }> {
    return new Promise((resolve) => {
        chrome.storage.local.get("rougechain-notif-settings", (data) => {
            const raw = data["rougechain-notif-settings"];
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    resolve({ mailEnabled: true, ...parsed });
                    return;
                } catch { /* fall through */ }
            }
            resolve({ enabled: true, txEnabled: true, msgEnabled: true, mailEnabled: true });
        });
    });
}

function showNotification(id: string, title: string, message: string, contextMessage?: string) {
    chrome.notifications.create(id, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title,
        message,
        contextMessage,
        priority: 2,
    });
}

function formatAmount(raw: number | undefined): string {
    if (raw === undefined || raw === null) return "";
    if (raw >= 1_000_000) return `${(raw / 1_000_000).toFixed(2)}M`;
    if (raw >= 1_000) return `${(raw / 1_000).toFixed(2)}K`;
    return String(raw);
}

function shortAddr(addr: string): string {
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

async function handleWsEvent(event: Record<string, unknown>) {
    const settings = await getNotifSettings();
    if (!settings.enabled) return;

    const wallet = await getWalletData();
    if (!wallet) return;

    const myKey = wallet.publicKey;
    const type = event.type as string;

    if (type === "new_transaction" && settings.txEnabled) {
        const from = event.from as string | undefined;
        const to = event.to as string | undefined;
        const amount = event.amount as number | undefined;
        const txType = (event.tx_type || "") as string;
        const txHash = (event.tx_hash || "") as string;
        const amtStr = formatAmount(amount);

        if (to === myKey && from !== myKey) {
            if (txType === "transfer" || txType === "") {
                showNotification(
                    `rx-${txHash}`,
                    "Received XRGE",
                    `${amtStr ? amtStr + " XRGE" : "Tokens"} from ${shortAddr(from || "unknown")}`,
                );
            } else if (txType === "token_transfer") {
                showNotification(
                    `rx-${txHash}`,
                    "Token Received",
                    `${amtStr || ""} tokens from ${shortAddr(from || "unknown")}`,
                );
            }
        } else if (from === myKey) {
            if (txType === "transfer" || txType === "") {
                showNotification(
                    `tx-${txHash}`,
                    "Transaction Confirmed",
                    `Sent ${amtStr ? amtStr + " XRGE" : ""} to ${shortAddr(to || "unknown")}`,
                );
            } else if (txType === "token_transfer") {
                showNotification(
                    `tx-${txHash}`,
                    "Token Sent",
                    `${amtStr || ""} tokens to ${shortAddr(to || "unknown")}`,
                );
            } else if (txType === "deploy_contract") {
                showNotification(
                    `tx-${txHash}`,
                    "Contract Deployed",
                    "Your smart contract was deployed successfully",
                );
            } else if (txType === "call_contract") {
                showNotification(
                    `tx-${txHash}`,
                    "Contract Call Confirmed",
                    "Your contract call executed successfully",
                );
            } else if (txType === "create_token") {
                showNotification(
                    `tx-${txHash}`,
                    "Token Created",
                    "Your new token was created on-chain",
                );
            } else if (txType === "stake") {
                showNotification(
                    `tx-${txHash}`,
                    "Stake Confirmed",
                    `${amtStr ? amtStr + " XRGE" : ""} staked as validator`,
                );
            } else if (txType === "unstake") {
                showNotification(
                    `tx-${txHash}`,
                    "Unstake Initiated",
                    "Your unstake request is being processed",
                );
            } else if (txType === "shield" || txType === "unshield") {
                showNotification(
                    `tx-${txHash}`,
                    txType === "shield" ? "Shield Confirmed" : "Unshield Confirmed",
                    `${amtStr ? amtStr + " XRGE" : ""} ${txType}ed successfully`,
                );
            } else {
                showNotification(
                    `tx-${txHash}`,
                    "Transaction Confirmed",
                    `${txType} transaction confirmed`,
                );
            }
        }
    }

    if (type === "balance_update" && settings.txEnabled) {
        const account = event.account as string | undefined;
        const token = event.token as string | undefined;
        const newBalance = event.new_balance as number | undefined;
        if (account === myKey && token && token !== "XRGE" && newBalance !== undefined) {
            showNotification(
                `bal-${token}-${Date.now()}`,
                `${token} Balance Updated`,
                `New balance: ${newBalance} ${token}`,
            );
        }
    }
}

async function connectWebSocket() {
    const wallet = await getWalletData();
    if (!wallet) return;

    const baseUrl = await getApiBaseUrl();
    const wsUrl = baseUrl.replace(/^http/, "ws").replace(/\/api$/, "/api/ws");

    if (wsConnection && (wsConnection.readyState === WebSocket.OPEN || wsConnection.readyState === WebSocket.CONNECTING)) {
        return;
    }

    try {
        wsConnection = new WebSocket(wsUrl);

        wsConnection.onopen = () => {
            console.log("[notif] WebSocket connected");
            wsConnection!.send(JSON.stringify({
                subscribe: [
                    `account:${wallet.publicKey}`,
                    "transactions",
                ],
            }));
        };

        wsConnection.onmessage = (ev) => {
            try {
                const data = JSON.parse(ev.data);
                handleWsEvent(data);
            } catch { /* ignore parse errors */ }
        };

        wsConnection.onclose = () => {
            console.log("[notif] WebSocket closed, reconnecting in 30s");
            wsConnection = null;
            if (wsRetryTimeout) clearTimeout(wsRetryTimeout);
            wsRetryTimeout = setTimeout(connectWebSocket, 30_000);
        };

        wsConnection.onerror = () => {
            wsConnection?.close();
        };
    } catch {
        if (wsRetryTimeout) clearTimeout(wsRetryTimeout);
        wsRetryTimeout = setTimeout(connectWebSocket, 30_000);
    }
}

async function checkUnreadMessages() {
    const settings = await getNotifSettings();
    if (!settings.enabled || !settings.msgEnabled) return;

    const wallet = await getWalletData();
    if (!wallet) return;

    const baseUrl = await getApiBaseUrl();
    try {
        const timestamp = Date.now();
        const nonce = `notif-${timestamp}`;
        const payload: Record<string, unknown> = { timestamp, nonce };
        const payloadStr = JSON.stringify(payload, Object.keys(payload).sort());
        const res = await fetch(`${baseUrl}/v2/messenger/conversations/list`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                payload,
                signature: "",
                public_key: wallet.publicKey,
            }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const convos = data.conversations || [];
        let total = 0;
        for (const c of convos) {
            total += (c.unread_count ?? 0);
        }

        const lastKnown = await getLastKnownUnread();
        if (total > lastKnown && lastKnown >= 0) {
            const diff = total - lastKnown;
            showNotification(
                `msg-${Date.now()}`,
                "New Message" + (diff > 1 ? "s" : ""),
                `You have ${diff} new encrypted message${diff > 1 ? "s" : ""}`,
            );
        }
        setLastKnownUnread(total);

        const mailUnread = await getLastKnownUnreadMail();
        const combinedBadge = total + Math.max(mailUnread, 0);
        chrome.action.setBadgeText({ text: combinedBadge > 0 ? String(combinedBadge) : "" });
        chrome.action.setBadgeBackgroundColor({ color: "#00CEB6" });
    } catch { /* ignore fetch errors */ }
}

async function checkUnreadMail() {
    const settings = await getNotifSettings();
    if (!settings.enabled || !settings.mailEnabled) return;

    const wallet = await getWalletData();
    if (!wallet) return;

    const baseUrl = await getApiBaseUrl();
    try {
        const timestamp = Date.now();
        const nonce = `mail-notif-${timestamp}`;
        const payload: Record<string, unknown> = { walletId: wallet.publicKey, folder: "inbox", timestamp, nonce };
        const res = await fetch(`${baseUrl}/v2/mail/folder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                payload,
                signature: "",
                public_key: wallet.publicKey,
            }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const messages = data.messages || [];
        let unreadCount = 0;
        for (const raw of messages) {
            const label = raw.label || {};
            const isRead = label.is_read ?? label.isRead ?? true;
            if (!isRead) unreadCount++;
        }

        const lastKnown = await getLastKnownUnreadMail();
        if (unreadCount > lastKnown && lastKnown >= 0) {
            const diff = unreadCount - lastKnown;
            showNotification(
                `mail-${Date.now()}`,
                "New Email" + (diff > 1 ? "s" : ""),
                `You have ${diff} new encrypted email${diff > 1 ? "s" : ""}`,
            );
        }
        setLastKnownUnreadMail(unreadCount);
    } catch { /* ignore fetch errors */ }
}

// Connect WS when wallet data becomes available
chrome.storage.onChanged.addListener((changes) => {
    if (changes["pqc-unified-wallet"]) {
        if (changes["pqc-unified-wallet"].newValue) {
            connectWebSocket();
            setLastKnownUnread(-1);
            setLastKnownUnreadMail(-1);
            checkUnreadMessages();
            checkUnreadMail();
        } else {
            wsConnection?.close();
            wsConnection = null;
            setLastKnownUnread(0);
            setLastKnownUnreadMail(0);
            chrome.action.setBadgeText({ text: "" });
        }
    }
});

// Click notification → open popup
chrome.notifications.onClicked.addListener((notifId) => {
    chrome.notifications.clear(notifId);
    chrome.action.openPopup?.();
});

// ─── Alarm handler (auto-lock + notification polling) ────

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "auto-lock") {
        chrome.storage.local.remove("pqc-unified-wallet");
    }
    if (alarm.name === "check-notifications") {
        checkUnreadMessages();
        checkUnreadMail();
        if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
            connectWebSocket();
        }
    }
});

// When popup signals unread counts updated, sync stored counts and badge
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "messages-read") {
        const total = typeof msg.unread === "number" ? msg.unread : 0;
        setLastKnownUnread(total);
        chrome.action.setBadgeText({ text: total > 0 ? String(total) : "" });
        chrome.action.setBadgeBackgroundColor({ color: "#00CEB6" });
    }
});

// Boot: try connecting immediately
connectWebSocket();
chrome.alarms.create("check-notifications", { periodInMinutes: 0.25 });

// ─── Storage helpers ─────────────────────────────────────

function getConnectedSites(): Promise<ConnectedSite[]> {
    return new Promise((resolve) => {
        chrome.storage.local.get("rougechain-connected-sites", (data) => {
            const raw = data["rougechain-connected-sites"];
            if (raw) {
                try {
                    resolve(JSON.parse(raw));
                    return;
                } catch { /* fall through */ }
            }
            resolve([]);
        });
    });
}

function saveConnectedSites(sites: ConnectedSite[]): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.set({
            "rougechain-connected-sites": JSON.stringify(sites),
        }, resolve);
    });
}

function getWalletData(): Promise<{ publicKey: string; privateKey: string } | null> {
    return new Promise((resolve) => {
        chrome.storage.local.get("pqc-unified-wallet", (data) => {
            const raw = data["pqc-unified-wallet"];
            if (!raw) { resolve(null); return; }
            try {
                const wallet = JSON.parse(raw);
                resolve({
                    publicKey: wallet.signingPublicKey,
                    privateKey: wallet.signingPrivateKey,
                });
            } catch { resolve(null); }
        });
    });
}

function getApiBaseUrl(): Promise<string> {
    return new Promise((resolve) => {
        chrome.storage.local.get(["rougechain-custom-node-url"], (data) => {
            const custom = data["rougechain-custom-node-url"];
            if (custom) {
                let url = custom.replace(/\/+$/, "");
                if (!url.endsWith("/api")) url += "/api";
                resolve(url);
                return;
            }
            resolve("https://testnet.rougechain.io/api");
        });
    });
}

// ─── Approval popup logic ────────────────────────────────

let approvalCounter = 0;

/**
 * Opens the approval popup and waits for the user to approve or deny.
 * Returns `true` if approved, `false` if denied or window closed.
 */
function requestApproval(
    type: "connect" | "sign" | "send",
    origin: string,
    payload?: Record<string, unknown>
): Promise<boolean> {
    return new Promise((resolve) => {
        const requestId = `${Date.now()}-${++approvalCounter}`;

        // Store payload data in session storage for the popup to read
        chrome.storage.session.set({
            [`approval-${requestId}`]: { payload, origin, type },
        });

        // Build the popup URL
        const params = new URLSearchParams({
            id: requestId,
            type,
            origin,
        });

        // Open approval popup window
        chrome.windows.create(
            {
                url: chrome.runtime.getURL(`approval.html?${params.toString()}`),
                type: "popup",
                width: 380,
                height: 520,
                focused: true,
            },
            (win) => {
                const windowId = win?.id;

                // Listen for the response from the popup
                const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
                    const responseKey = `approval-response-${requestId}`;
                    if (changes[responseKey]) {
                        cleanup();
                        const response = changes[responseKey].newValue;
                        resolve(response?.approved === true);
                    }
                };

                // Listen for window close (user closed without clicking)
                const windowListener = (closedWindowId: number) => {
                    if (closedWindowId === windowId) {
                        // Give a brief moment for storage write to complete
                        setTimeout(() => {
                            chrome.storage.session.get(`approval-response-${requestId}`, (data) => {
                                const response = data[`approval-response-${requestId}`];
                                cleanup();
                                if (response) {
                                    resolve(response.approved === true);
                                } else {
                                    resolve(false); // Window closed = deny
                                }
                            });
                        }, 300);
                    }
                };

                const cleanup = () => {
                    chrome.storage.session.onChanged.removeListener(storageListener);
                    chrome.windows.onRemoved.removeListener(windowListener);
                    // Clean up stored data
                    chrome.storage.session.remove([
                        `approval-${requestId}`,
                        `approval-response-${requestId}`,
                    ]);
                };

                chrome.storage.session.onChanged.addListener(storageListener);
                chrome.windows.onRemoved.addListener(windowListener);

                // Timeout after 2 minutes
                setTimeout(() => {
                    cleanup();
                    resolve(false);
                }, 120_000);
            }
        );
    });
}

// ─── dApp message handler ────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "rougechain-request") return false;

    const { method, params, origin } = message;

    (async () => {
        try {
            switch (method) {
                case "connect": {
                    const wallet = await getWalletData();
                    if (!wallet) {
                        sendResponse({ error: "Wallet is locked or not set up" });
                        return;
                    }

                    // Check if already connected — skip approval
                    const sites = await getConnectedSites();
                    const alreadyConnected = sites.some(s => s.origin === origin);

                    if (!alreadyConnected) {
                        // Open approval popup
                        const approved = await requestApproval("connect", origin);
                        if (!approved) {
                            sendResponse({ error: "User denied connection" });
                            return;
                        }
                        sites.push({ origin, connectedAt: Date.now() });
                        await saveConnectedSites(sites);
                    }

                    sendResponse({ result: { publicKey: wallet.publicKey } });
                    break;
                }

                case "getBalance": {
                    const wallet = await getWalletData();
                    if (!wallet) {
                        sendResponse({ error: "Wallet is locked" });
                        return;
                    }

                    const sites = await getConnectedSites();
                    if (!sites.some(s => s.origin === origin)) {
                        sendResponse({ error: "Site not connected. Call connect() first." });
                        return;
                    }

                    const baseUrl = await getApiBaseUrl();
                    const res = await fetch(`${baseUrl}/balance/${wallet.publicKey}`);
                    if (!res.ok) {
                        sendResponse({ error: `Node returned ${res.status}` });
                        return;
                    }
                    const data = await res.json() as {
                        success: boolean;
                        balance: number;
                        token_balances?: Record<string, number>;
                    };

                    sendResponse({
                        result: {
                            balance: data.balance || 0,
                            tokens: data.token_balances || {},
                        },
                    });
                    break;
                }

                case "signTransaction": {
                    const wallet = await getWalletData();
                    if (!wallet) {
                        sendResponse({ error: "Wallet is locked" });
                        return;
                    }

                    const sites = await getConnectedSites();
                    if (!sites.some(s => s.origin === origin)) {
                        sendResponse({ error: "Site not connected" });
                        return;
                    }

                    const payload = params?.payload;
                    if (!payload || typeof payload !== "object") {
                        sendResponse({ error: "Invalid payload" });
                        return;
                    }

                    // Open approval popup for signing
                    const signApproved = await requestApproval("sign", origin, payload as Record<string, unknown>);
                    if (!signApproved) {
                        sendResponse({ error: "User denied signature request" });
                        return;
                    }

                    const signedPayload = JSON.stringify(payload, Object.keys(payload).sort());
                    sendResponse({
                        result: {
                            signedPayload,
                            publicKey: wallet.publicKey,
                        },
                    });
                    break;
                }

                case "sendTransaction": {
                    const wallet = await getWalletData();
                    if (!wallet) {
                        sendResponse({ error: "Wallet is locked" });
                        return;
                    }

                    const sites = await getConnectedSites();
                    if (!sites.some(s => s.origin === origin)) {
                        sendResponse({ error: "Site not connected" });
                        return;
                    }

                    const payload = params?.payload;
                    if (!payload || typeof payload !== "object") {
                        sendResponse({ error: "Invalid payload" });
                        return;
                    }

                    // Open approval popup for transaction
                    const sendApproved = await requestApproval("send", origin, payload as Record<string, unknown>);
                    if (!sendApproved) {
                        sendResponse({ error: "User denied transaction" });
                        return;
                    }

                    const baseUrl = await getApiBaseUrl();
                    const txPayload = {
                        ...payload as Record<string, unknown>,
                        from: wallet.publicKey,
                        timestamp: Date.now(),
                        nonce: crypto.randomUUID(),
                    };

                    const res = await fetch(`${baseUrl}/v2/tx/submit`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            payload: txPayload,
                            signature: "",
                            public_key: wallet.publicKey,
                        }),
                    });

                    const data = await res.json();
                    if (data.success) {
                        sendResponse({ result: { txId: data.txId || data.tx_id } });
                    } else {
                        sendResponse({ error: data.error || "Transaction failed" });
                    }
                    break;
                }

                default:
                    sendResponse({ error: `Unknown method: ${method}` });
            }
        } catch (err: any) {
            sendResponse({ error: err.message || "Internal error" });
        }
    })();

    return true; // keep the message channel open for async response
});

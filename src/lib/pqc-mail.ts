/**
 * PQC Mail — On-chain encrypted email with @rouge.quant addressing
 * Uses v2 multi-recipient CEK encryption (ML-KEM-768 + AES-GCM + HKDF)
 */
import { getCoreApiBaseUrl, getCoreApiHeaders } from "./network";
import { cachedFetch, invalidate, type CacheCategory } from "./api-cache";
import { buildSignedRequest, type WalletWithPrivateKeys, type Wallet, getWallets } from "./pqc-messenger";

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

async function encryptForMultipleRecipients(
    plaintext: string,
    recipientEncPubKeys: string[],
    senderEncPubKey: string,
): Promise<string> {
    const { ml_kem768 } = await import("@noble/post-quantum/ml-kem.js");

    const cek = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        new TextEncoder().encode(plaintext),
    );

    const wrappedKeys: Record<string, { kemCipherText: string; wrappedCek: string; wrappedIv: string }> = {};
    const allKeys = [...new Set([...recipientEncPubKeys, senderEncPubKey])];

    for (const encPubKey of allKeys) {
        if (!encPubKey) continue;
        const { cipherText, sharedSecret } = ml_kem768.encapsulate(hexToBytes(encPubKey));
        const ssBuf = sharedSecret.buffer.slice(sharedSecret.byteOffset, sharedSecret.byteOffset + sharedSecret.byteLength) as ArrayBuffer;
        const keyMaterial = await crypto.subtle.importKey("raw", ssBuf, "HKDF", false, ["deriveKey"]);
        const wrapKey = await crypto.subtle.deriveKey(
            { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("pqc-cek-wrap") },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt"],
        );
        const wrapIv = crypto.getRandomValues(new Uint8Array(12));
        const wrappedCek = await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv }, wrapKey, cek);

        wrappedKeys[encPubKey] = {
            kemCipherText: bytesToHex(cipherText),
            wrappedCek: bytesToHex(new Uint8Array(wrappedCek)),
            wrappedIv: bytesToHex(wrapIv),
        };
    }

    return JSON.stringify({
        version: 2,
        iv: bytesToHex(iv),
        encryptedContent: bytesToHex(new Uint8Array(encrypted)),
        wrappedKeys,
    });
}

async function decryptMailContent(
    encryptedPackage: string,
    recipientEncPrivKey: string,
    recipientEncPubKey: string,
): Promise<string> {
    const parsed = JSON.parse(encryptedPackage);

    if (parsed.version === 2 && parsed.wrappedKeys) {
        const { ml_kem768 } = await import("@noble/post-quantum/ml-kem.js");
        const myWrappedKey = parsed.wrappedKeys[recipientEncPubKey];
        if (!myWrappedKey) throw new Error("No wrapped key for this recipient");

        const privKeyBytes = hexToBytes(recipientEncPrivKey);
        const sharedSecret = ml_kem768.decapsulate(hexToBytes(myWrappedKey.kemCipherText), privKeyBytes);
        const ssBuf = sharedSecret.buffer.slice(sharedSecret.byteOffset, sharedSecret.byteOffset + sharedSecret.byteLength) as ArrayBuffer;
        const keyMaterial = await crypto.subtle.importKey("raw", ssBuf, "HKDF", false, ["deriveKey"]);
        const unwrapKey = await crypto.subtle.deriveKey(
            { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("pqc-cek-wrap") },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"],
        );
        const cekBytes = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: hexToBytes(myWrappedKey.wrappedIv) },
            unwrapKey,
            hexToBytes(myWrappedKey.wrappedCek),
        );
        const cek = await crypto.subtle.importKey("raw", cekBytes, { name: "AES-GCM" }, false, ["decrypt"]);
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: hexToBytes(parsed.iv) },
            cek,
            hexToBytes(parsed.encryptedContent),
        );
        return new TextDecoder().decode(decrypted);
    }

    throw new Error("Unsupported encryption format");
}

export const MAIL_DOMAIN = "rouge.quant";
export const MAIL_DOMAIN_ALT = "qwalla.mail";
export const MAIL_DOMAINS = [MAIL_DOMAIN, MAIL_DOMAIN_ALT];

export interface MailMessage {
    id: string;
    fromWalletId: string;
    toWalletIds: string[];
    subjectEncrypted: string;
    bodyEncrypted: string;
    attachmentEncrypted?: string;
    signature: string;
    createdAt: string;
    replyToId?: string;
    hasAttachment: boolean;
    attachmentHash?: string;
    // Decrypted client-side fields
    subject?: string;
    body?: string;
    signatureValid?: boolean | null;
    senderName?: string;
}

export interface MailLabel {
    messageId: string;
    walletId: string;
    folder: string;
    isRead: boolean;
}

export interface MailItem {
    message: MailMessage;
    label: MailLabel;
}

export interface NameEntry {
    name: string;
    wallet_id: string;
    registered_at: string;
}

function getMailApiBase(): string | null {
    const base = getCoreApiBaseUrl();
    return base ? base : null;
}

// --- Name Registry ---

export async function registerName(wallet: WalletWithPrivateKeys, name: string, walletId: string): Promise<{ success: boolean; error?: string; entry?: NameEntry }> {
    const base = getMailApiBase();
    if (!base) throw new Error("Node not configured");

    const signed = buildSignedRequest(
        { name, walletId },
        wallet.signingPrivateKey,
        wallet.signingPublicKey,
    );
    const res = await fetch(`${base}/v2/names/register`, {
        method: "POST",
        headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(signed),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: text || "Registration failed" };
    }
    const data = await res.json();
    if (data.success) invalidate("nameRegistry" as CacheCategory);
    return data;
}

export async function resolveName(name: string): Promise<{ entry?: NameEntry; wallet?: Wallet } | null> {
    const base = getMailApiBase();
    if (!base) return null;

    let cleanName = name;
    for (const domain of MAIL_DOMAINS) {
        cleanName = cleanName.replace(`@${domain}`, "");
    }
    cleanName = cleanName.toLowerCase();

    return cachedFetch("nameRegistry" as CacheCategory, cleanName, async () => {
        const res = await fetch(`${base}/names/resolve/${encodeURIComponent(cleanName)}`, {
            headers: getCoreApiHeaders(),
        });
        const data = await res.json();
        if (!data.success) return null;
        return {
            entry: data.entry,
            wallet: data.wallet ? normalizeWallet(data.wallet) : undefined,
        };
    });
}

export async function reverseLookup(walletId: string): Promise<string | null> {
    const base = getMailApiBase();
    if (!base) return null;

    return cachedFetch("nameRegistry" as CacheCategory, `rev:${walletId}`, async () => {
        const res = await fetch(`${base}/names/reverse/${encodeURIComponent(walletId)}`, {
            headers: getCoreApiHeaders(),
        });
        const data = await res.json();
        return data.name || null;
    });
}

export async function releaseName(wallet: WalletWithPrivateKeys, name: string, walletId: string): Promise<{ success: boolean; error?: string }> {
    const base = getMailApiBase();
    if (!base) throw new Error("Node not configured");

    const signed = buildSignedRequest(
        { name, walletId },
        wallet.signingPrivateKey,
        wallet.signingPublicKey,
    );
    const res = await fetch(`${base}/v2/names/release`, {
        method: "POST",
        headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(signed),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, error: text || "Release failed" };
    }
    const data = await res.json();
    if (data.success) invalidate("nameRegistry" as CacheCategory);
    return data;
}

// --- Mail ---

export async function sendMail(
    wallet: WalletWithPrivateKeys,
    toWalletIds: string[],
    subject: string,
    body: string,
    replyToId?: string,
): Promise<MailMessage> {
    const base = getMailApiBase();
    if (!base) throw new Error("Node not configured");

    const allWallets = await getWallets();

    const recipientEncPubKeys: string[] = [];
    for (const toId of toWalletIds) {
        const w = allWallets.find(w => w.id === toId);
        if (!w?.encryptionPublicKey) throw new Error(`Recipient ${toId} encryption key not found`);
        recipientEncPubKeys.push(w.encryptionPublicKey);
    }

    const subjectEncrypted = await encryptForMultipleRecipients(subject, recipientEncPubKeys, wallet.encryptionPublicKey);
    const bodyEncrypted = await encryptForMultipleRecipients(body, recipientEncPubKeys, wallet.encryptionPublicKey);

    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js");
    const sigPayload = subjectEncrypted + "|" + bodyEncrypted;
    const sigBytes = ml_dsa65.sign(
        new TextEncoder().encode(sigPayload),
        hexToBytes(wallet.signingPrivateKey),
    );
    const mailSignature = bytesToHex(sigBytes);

    const signed = buildSignedRequest(
        {
            fromWalletId: wallet.id,
            toWalletIds,
            subjectEncrypted,
            bodyEncrypted,
            contentSignature: mailSignature,
            replyToId: replyToId || null,
            hasAttachment: false,
        },
        wallet.signingPrivateKey,
        wallet.signingPublicKey,
    );
    const res = await fetch(`${base}/v2/mail/send`, {
        method: "POST",
        headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(signed),
    });

    if (!res.ok) throw new Error(`Send failed: ${await res.text()}`);
    invalidate("mailInbox" as CacheCategory);
    invalidate("mailSent" as CacheCategory);

    const data = await res.json();
    return {
        ...normalizeMailMessage(data.message || data),
        subject,
        body,
        signatureValid: true,
        senderName: wallet.displayName,
    };
}

export async function getUnreadMailCount(wallet: WalletWithPrivateKeys): Promise<number> {
    const base = getMailApiBase();
    if (!base) return 0;
    try {
        const signed = buildSignedRequest(
            { walletId: wallet.id, folder: "inbox" },
            wallet.signingPrivateKey,
            wallet.signingPublicKey,
        );
        const res = await fetch(`${base}/v2/mail/folder`, {
            method: "POST",
            headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify(signed),
        });
        if (!res.ok) return 0;
        const data = await res.json();
        const messages = data.messages || [];
        let count = 0;
        for (const raw of messages) {
            const label = raw.label || {};
            const isRead = label.is_read ?? label.isRead ?? true;
            if (!isRead) count++;
        }
        return count;
    } catch { return 0; }
}

export async function getInbox(wallet: WalletWithPrivateKeys): Promise<MailItem[]> {
    return getFolder(wallet, "inbox", "mailInbox" as CacheCategory);
}

export async function getSent(wallet: WalletWithPrivateKeys): Promise<MailItem[]> {
    return getFolder(wallet, "sent", "mailSent" as CacheCategory);
}

export async function getTrash(wallet: WalletWithPrivateKeys): Promise<MailItem[]> {
    return getFolder(wallet, "trash", "mailTrash" as CacheCategory);
}

async function getFolder(wallet: WalletWithPrivateKeys, folder: string, cacheCategory: CacheCategory): Promise<MailItem[]> {
    const base = getMailApiBase();
    if (!base) return [];

    try {
        const rawItems = await cachedFetch(cacheCategory, wallet.id, async () => {
            const signed = buildSignedRequest(
                { walletId: wallet.id, folder },
                wallet.signingPrivateKey,
                wallet.signingPublicKey,
            );
            const res = await fetch(`${base}/v2/mail/folder`, {
                method: "POST",
                headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify(signed),
            });
            if (!res.ok) return [];
            const data = await res.json();
            return data.messages || [];
        });

        const allWallets = await getWallets();
        const items: MailItem[] = [];

        for (const raw of rawItems) {
            const msg = normalizeMailMessage(raw.message || raw);
            const label = normalizeMailLabel(raw.label || {});
            const isSender = msg.fromWalletId === wallet.id;

            const senderWallet = allWallets.find(w =>
                w.id === msg.fromWalletId ||
                w.signingPublicKey === msg.fromWalletId ||
                w.encryptionPublicKey === msg.fromWalletId
            );
            const senderSigningKey = senderWallet?.signingPublicKey || wallet.signingPublicKey;

            let subject = "[Unable to decrypt]";
            let body = "[Unable to decrypt]";
            let signatureValid: boolean | null = null;

            try {
                subject = await decryptMailContent(msg.subjectEncrypted, wallet.encryptionPrivateKey, wallet.encryptionPublicKey);
            } catch { /* */ }

            try {
                body = await decryptMailContent(msg.bodyEncrypted, wallet.encryptionPrivateKey, wallet.encryptionPublicKey);
            } catch { /* */ }

            if (msg.signature && senderSigningKey) {
                try {
                    const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js");
                    const sigPayload = msg.subjectEncrypted + "|" + msg.bodyEncrypted + (msg.attachmentEncrypted ? "|" + msg.attachmentEncrypted : "");
                    signatureValid = ml_dsa65.verify(
                        hexToBytes(msg.signature),
                        new TextEncoder().encode(sigPayload),
                        hexToBytes(senderSigningKey),
                    );
                } catch {
                    signatureValid = false;
                }
            }

            const senderName = await getSenderDisplayName(msg.fromWalletId, allWallets);

            items.push({
                message: { ...msg, subject, body, signatureValid, senderName },
                label,
            });
        }

        return items;
    } catch {
        return [];
    }
}

async function getSenderDisplayName(walletId: string, allWallets: Wallet[]): Promise<string> {
    const name = await reverseLookup(walletId);
    if (name) return `${name}@${MAIL_DOMAIN}`;
    const w = allWallets.find(w => w.id === walletId);
    return w?.displayName || walletId.substring(0, 12) + "...";
}

export async function moveMail(wallet: WalletWithPrivateKeys, messageId: string, folder: string): Promise<void> {
    const base = getMailApiBase();
    if (!base) throw new Error("Node not configured");

    const signed = buildSignedRequest(
        { walletId: wallet.id, messageId, folder },
        wallet.signingPrivateKey,
        wallet.signingPublicKey,
    );
    const res = await fetch(`${base}/v2/mail/move`, {
        method: "POST",
        headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(signed),
    });
    if (!res.ok) throw new Error(`Move failed: ${await res.text()}`);
    invalidate("mailInbox" as CacheCategory);
    invalidate("mailSent" as CacheCategory);
    invalidate("mailTrash" as CacheCategory);
}

export async function markMailRead(wallet: WalletWithPrivateKeys, messageId: string): Promise<void> {
    const base = getMailApiBase();
    if (!base) throw new Error("Node not configured");

    const signed = buildSignedRequest(
        { walletId: wallet.id, messageId },
        wallet.signingPrivateKey,
        wallet.signingPublicKey,
    );
    await fetch(`${base}/v2/mail/read`, {
        method: "POST",
        headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(signed),
    });
}

export async function deleteMail(wallet: WalletWithPrivateKeys, messageId: string): Promise<void> {
    const base = getMailApiBase();
    if (!base) throw new Error("Node not configured");

    const signed = buildSignedRequest(
        { walletId: wallet.id, messageId },
        wallet.signingPrivateKey,
        wallet.signingPublicKey,
    );
    const res = await fetch(`${base}/v2/mail/delete`, {
        method: "POST",
        headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(signed),
    });
    if (!res.ok) throw new Error(`Delete failed: ${await res.text()}`);
    invalidate("mailInbox" as CacheCategory);
    invalidate("mailSent" as CacheCategory);
    invalidate("mailTrash" as CacheCategory);
}

/**
 * Resolve a recipient string — accepts @qwalla.mail, @rouge.quant, or raw wallet ID
 */
export async function resolveRecipient(input: string): Promise<string | null> {
    const trimmed = input.trim();

    if (MAIL_DOMAINS.some(d => trimmed.includes(`@${d}`))) {
        let name = trimmed;
        for (const d of MAIL_DOMAINS) {
            name = name.replace(`@${d}`, "");
        }
        name = name.toLowerCase();
        const result = await resolveName(name);
        return result?.entry?.wallet_id || null;
    }

    // Treat as raw wallet ID
    if (trimmed.length > 20) return trimmed;

    // Could be just a name without the domain
    const result = await resolveName(trimmed);
    return result?.entry?.wallet_id || null;
}

// --- Helpers ---

function normalizeWallet(raw: any): Wallet {
    return {
        id: raw.id,
        displayName: raw.display_name || raw.displayName || "Unknown",
        signingPublicKey: raw.signing_public_key || raw.signingPublicKey || "",
        encryptionPublicKey: raw.encryption_public_key || raw.encryptionPublicKey || "",
        createdAt: raw.created_at || raw.createdAt,
    };
}

function normalizeMailMessage(raw: any): MailMessage {
    return {
        id: raw.id,
        fromWalletId: raw.from_wallet_id || raw.fromWalletId || "",
        toWalletIds: raw.to_wallet_ids || raw.toWalletIds || [],
        subjectEncrypted: raw.subject_encrypted || raw.subjectEncrypted || "",
        bodyEncrypted: raw.body_encrypted || raw.bodyEncrypted || "",
        attachmentEncrypted: raw.attachment_encrypted || raw.attachmentEncrypted,
        signature: raw.signature || "",
        createdAt: raw.created_at || raw.createdAt || "",
        replyToId: raw.reply_to_id || raw.replyToId,
        hasAttachment: raw.has_attachment || raw.hasAttachment || false,
        attachmentHash: raw.attachment_hash || raw.attachmentHash,
    };
}

function normalizeMailLabel(raw: any): MailLabel {
    return {
        messageId: raw.message_id || raw.messageId || "",
        walletId: raw.wallet_id || raw.walletId || "",
        folder: raw.folder || "inbox",
        isRead: raw.is_read ?? raw.isRead ?? false,
    };
}

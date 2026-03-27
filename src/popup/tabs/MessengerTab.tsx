import { useState, useEffect, useRef } from "react";
import {
    ArrowLeft, Send, Lock, Shield, Plus, Loader2,
    MessageCircle, CheckCircle2, XCircle, Timer,
    Paperclip, EyeOff, Image as ImageIcon, Video, X, Trash2, KeyRound, Ban, Eye
} from "lucide-react";
import type { UnifiedWallet } from "../../lib/unified-wallet";
import { toMessengerWallet, saveUnifiedWallet } from "../../lib/unified-wallet";
import {
    getConversations,
    getMessages,
    getWallets,
    sendMessage,
    createConversation,
    deleteConversation,
    registerWalletOnNode,
    fileToMediaPayload,
    MAX_MEDIA_SIZE,
    isWalletBlocked,
    blockWallet,
    unblockWallet,
    getBlockedWalletIds,
    getPrivacySettings,
    savePrivacySettings,
    type Conversation,
    type Message,
    type MessageType,
    markConversationRead,
    type Wallet,
    type WalletWithPrivateKeys,
} from "../../lib/pqc-messenger";
import { formatIdentity } from "../../lib/address";

interface Props {
    wallet: UnifiedWallet;
}

function formatTime(dateInput: string | number | Date): string {
    try {
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return "";
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
}

export default function MessengerTab({ wallet }: Props) {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selected, setSelected] = useState<Conversation | null>(null);
    const [contacts, setContacts] = useState<Wallet[]>([]);
    const [showContacts, setShowContacts] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [regStatus, setRegStatus] = useState<"pending" | "ok" | "error">("pending");
    const [regError, setRegError] = useState<string | null>(null);
    const [isRegeneratingKeys, setIsRegeneratingKeys] = useState(false);
    const [discoverable, setDiscoverable] = useState(() => getPrivacySettings().discoverable);

    const messengerWallet = toMessengerWallet(wallet) as WalletWithPrivateKeys;

    const loadConversations = async () => {
        const convos = await getConversations(wallet.id, messengerWallet);
        setConversations(convos);
        setIsLoading(false);
    };

    const loadContacts = async () => {
        const wallets = await getWallets();
        const blocked = new Set(getBlockedWalletIds());
        setContacts(wallets.filter(w =>
            w.id !== wallet.id &&
            !blocked.has(w.id) && !blocked.has(w.signingPublicKey) && !blocked.has(w.encryptionPublicKey)
        ));
    };

    const doRegister = async () => {
        setRegStatus("pending");
        setRegError(null);
        try {
            await registerWalletOnNode(messengerWallet);
            setRegStatus("ok");
        } catch (err: any) {
            setRegStatus("error");
            setRegError(err.message || "Registration failed");
        }
    };

    useEffect(() => {
        doRegister();
        loadConversations();
        loadContacts();
        const interval = setInterval(loadConversations, 5000);
        return () => clearInterval(interval);
    }, []);

    if (selected) {
        return (
            <ChatView
                conversation={selected}
                wallet={messengerWallet}
                onBack={() => setSelected(null)}
                onBlocked={() => {
                    setSelected(null);
                    loadConversations();
                }}
            />
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Conversations
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={async () => {
                            if (isRegeneratingKeys) return;
                            setIsRegeneratingKeys(true);
                            try {
                                const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js");
                                const { ml_kem768 } = await import("@noble/post-quantum/ml-kem.js");
                                const bytesToHex = (bytes: Uint8Array) =>
                                    Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
                                const sigKeypair = ml_dsa65.keygen();
                                const encKeypair = ml_kem768.keygen();
                                const updated: UnifiedWallet = {
                                    ...wallet,
                                    signingPublicKey: bytesToHex(sigKeypair.publicKey),
                                    signingPrivateKey: bytesToHex(sigKeypair.secretKey),
                                    encryptionPublicKey: bytesToHex(encKeypair.publicKey),
                                    encryptionPrivateKey: bytesToHex(encKeypair.secretKey),
                                    version: 4,
                                };
                                // Write directly to chrome.storage.local and AWAIT it
                                // saveUnifiedWallet is fire-and-forget, which loses data on reload
                                const storageKey = "pqc-unified-wallet";
                                await chrome.storage.local.set({ [storageKey]: JSON.stringify(updated) });
                                // Also update the in-memory cache
                                saveUnifiedWallet(updated);
                                await registerWalletOnNode(toMessengerWallet(updated) as WalletWithPrivateKeys);
                                setRegStatus("ok");
                                setRegError(null);
                                // Now safe to reload since storage write completed
                                window.location.reload();
                            } catch (err: any) {
                                setRegError(err.message || "Key regeneration failed");
                                setRegStatus("error");
                            } finally {
                                setIsRegeneratingKeys(false);
                            }
                        }}
                        className="w-7 h-7 rounded-lg bg-yellow-500/20 flex items-center justify-center text-yellow-400 hover:bg-yellow-500/30 transition-colors"
                        title="Regenerate keys (fixes key mismatch errors)"
                    >
                        <KeyRound className={`w-3.5 h-3.5 ${isRegeneratingKeys ? "animate-spin" : ""}`} />
                    </button>
                    <button
                        onClick={async () => {
                            const next = !discoverable;
                            setDiscoverable(next);
                            savePrivacySettings({ discoverable: next });
                            await registerWalletOnNode(messengerWallet);
                        }}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                            discoverable
                                ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                                : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        }`}
                        title={discoverable ? "Discoverable: ON (visible to others)" : "Discoverable: OFF (hidden from contacts)"}
                    >
                        {discoverable ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={() => { setShowContacts(!showContacts); loadContacts(); }}
                        className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center text-primary hover:bg-primary/30 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Registration status */}
            {regStatus === "error" && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-destructive/10 border-b border-destructive/20">
                    <span className="text-[10px] text-destructive truncate">{regError || "Registration failed"}</span>
                    <button onClick={doRegister} className="text-[10px] text-destructive font-medium hover:underline flex-shrink-0 ml-2">Retry</button>
                </div>
            )}
            {regStatus === "ok" && (
                <div className="flex items-center gap-1 px-3 py-1 bg-success/5 border-b border-success/10">
                    <CheckCircle2 className="w-2.5 h-2.5 text-success" />
                    <span className="text-[10px] text-success">Registered on node</span>
                </div>
            )}

            {/* Contact picker */}
            {showContacts && (
                <div className="border-b border-border bg-card/80 max-h-40 overflow-y-auto">
                    {contacts.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3 text-center">No contacts found</p>
                    ) : (
                        contacts.map(c => (
                            <button
                                key={c.id}
                                onClick={async () => {
                                    try {
                                        const convo = await createConversation(
                                            messengerWallet,
                                            [wallet.id, c.id],
                                        );
                                        setConversations(prev => [convo, ...prev]);
                                        setSelected(convo);
                                        setShowContacts(false);
                                    } catch (err) { console.error(err); }
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors text-left"
                            >
                                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                                    <Shield className="w-3.5 h-3.5 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-foreground truncate">{c.displayName}</p>
                                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                                        {formatIdentity(c.signingPublicKey)}
                                    </p>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            )}

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-32">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <MessageCircle className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">No conversations yet</p>
                        <p className="text-[10px]">Tap + to start one</p>
                    </div>
                ) : (
                    conversations.map(convo => {
                        const myIds = new Set([wallet.id, wallet.signingPublicKey, wallet.encryptionPublicKey].filter(Boolean));
                        const other = convo.participants?.find(p =>
                            !myIds.has(p.id) && !myIds.has(p.signingPublicKey) && !myIds.has(p.encryptionPublicKey)
                        );
                        return (
                            <div
                                key={convo.id}
                                className="flex items-center border-b border-border/50 hover:bg-secondary/30 transition-colors"
                            >
                                <button
                                    onClick={() => setSelected(convo)}
                                    className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left min-w-0"
                                >
                                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                                        <MessageCircle className="w-4 h-4 text-primary" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-foreground truncate">
                                            {convo.name || other?.displayName || "Unknown"}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                            <Lock className="w-2.5 h-2.5" /> End-to-end encrypted
                                        </p>
                                    </div>
                                </button>
                                <button
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        if (!confirm("Delete this conversation?")) return;
                                        try {
                                            await deleteConversation(messengerWallet, convo.id);
                                            setConversations(prev => prev.filter(c => c.id !== convo.id));
                                        } catch (err) { console.error("Delete failed:", err); }
                                    }}
                                    className="px-2 py-2.5 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                                    title="Delete conversation"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// Compact chat view for extension popup
function ChatView({
    conversation,
    wallet,
    onBack,
    onBlocked,
}: {
    conversation: Conversation;
    wallet: WalletWithPrivateKeys;
    onBack: () => void;
    onBlocked?: () => void;
}) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [stagedMedia, setStagedMedia] = useState<{ file: File; previewUrl: string } | null>(null);
    const [spoiler, setSpoiler] = useState(false);
    const [selfDestruct, setSelfDestruct] = useState(false);
    const [resolvedRecipient, setResolvedRecipient] = useState<Wallet | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef(0);

    const myIds = new Set([wallet.id, wallet.signingPublicKey, wallet.encryptionPublicKey].filter(Boolean));
    const participantRecipient = conversation.participants?.find(p =>
        !myIds.has(p.id) && !myIds.has(p.signingPublicKey) && !myIds.has(p.encryptionPublicKey)
    );
    const recipient = participantRecipient || resolvedRecipient;
    const recipientMainId = recipient?.id || recipient?.signingPublicKey || "";
    const [blocked, setBlocked] = useState(() => recipientMainId ? isWalletBlocked(recipientMainId) : false);

    const handleToggleBlock = () => {
        if (!recipientMainId) return;
        if (blocked) {
            unblockWallet(recipientMainId);
            setBlocked(false);
        } else {
            if (!confirm(`Block ${recipient?.displayName || "this user"}?`)) return;
            blockWallet(recipientMainId);
            setBlocked(true);
            onBlocked?.();
        }
    };

    useEffect(() => {
        if (!participantRecipient && conversation.participantIds) {
            const otherId = conversation.participantIds.find(id => !myIds.has(id));
            if (otherId) {
                getWallets().then(wallets => {
                    const match = wallets.find(w => w.id === otherId);
                    if (match) setResolvedRecipient(match);
                }).catch(() => {});
            }
        }
    }, [participantRecipient, conversation.participantIds, wallet.id]);

    const loadMessages = async () => {
        try {
            const msgs = await getMessages(
                conversation.id,
                wallet,
                conversation.participants || []
            );
            setMessages(prev => {
                if (prev.length === 0) return msgs;
                const existing = new Map(prev.map(m => [m.id, m]));
                return msgs.map(m => {
                    const old = existing.get(m.id);
                    if (!old) return m;
                    const oldGood = old.plaintext && !old.plaintext.startsWith("[Unable");
                    const newBad = !m.plaintext || m.plaintext.startsWith("[Unable");
                    if (oldGood && newBad) {
                        return { ...m, plaintext: old.plaintext, signatureValid: old.signatureValid, mediaUrl: old.mediaUrl, mediaFileName: old.mediaFileName, messageType: old.messageType };
                    }
                    if (old.mediaUrl && !m.mediaUrl) {
                        return { ...m, mediaUrl: old.mediaUrl, mediaFileName: old.mediaFileName, messageType: old.messageType, plaintext: old.plaintext };
                    }
                    return m;
                });
            });
            markConversationRead(wallet, conversation.id, msgs).catch(() => {});
        } catch (err) { console.error(err); }
        setIsLoading(false);
    };

    useEffect(() => {
        loadMessages();
        const interval = setInterval(loadMessages, 3000);
        return () => clearInterval(interval);
    }, [conversation.id]);

    useEffect(() => {
        if (messages.length > prevCountRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
        prevCountRef.current = messages.length;
    }, [messages.length]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > MAX_MEDIA_SIZE) {
            alert(`File too large. Max ${MAX_MEDIA_SIZE / (1024 * 1024)} MB.`);
            return;
        }
        if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
            alert("Only images and videos are supported.");
            return;
        }
        setStagedMedia({ file, previewUrl: URL.createObjectURL(file) });
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const clearStagedMedia = () => {
        if (stagedMedia) {
            URL.revokeObjectURL(stagedMedia.previewUrl);
            setStagedMedia(null);
        }
    };

    const [sendError, setSendError] = useState<string | null>(null);

    const handleSend = async () => {
        if ((!newMessage.trim() && !stagedMedia) || isSending) return;
        setSendError(null);

        if (!recipient) {
            setSendError("Recipient not found. They may not be registered.");
            return;
        }

        setIsSending(true);

        let textToSend = newMessage.trim();
        let msgType: MessageType = "text";

        if (stagedMedia) {
            try {
                const { payload, messageType } = await fileToMediaPayload(stagedMedia.file);
                textToSend = payload;
                msgType = messageType;
                clearStagedMedia();
            } catch (err) {
                setSendError(err instanceof Error ? err.message : "Failed to process media.");
                setIsSending(false);
                return;
            }
        }

        setNewMessage("");

        try {
            let recipientKey = recipient.encryptionPublicKey;
            if (!recipientKey) {
                const wallets = await getWallets();
                const match = wallets.find(w => w.id === recipient.id);
                if (!match?.encryptionPublicKey) {
                    setSendError("Recipient's encryption key not found");
                    setIsSending(false);
                    return;
                }
                recipientKey = match.encryptionPublicKey;
            }
            const msg = await sendMessage(
                conversation.id, textToSend, wallet, recipientKey,
                selfDestruct, selfDestruct ? 30 : undefined, msgType, spoiler
            );
            setMessages(prev => [...prev, msg]);
        } catch (err: any) {
            console.error("Send failed:", err);
            setSendError(err.message || "Send failed");
        }
        setIsSending(false);
        setSpoiler(false);
        setSelfDestruct(false);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Chat header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50">
                <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                    <Shield className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">
                        {conversation.name || recipient?.displayName || "Unknown"}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Lock className="w-2 h-2" /> ML-KEM-768 + ML-DSA-65
                    </p>
                </div>
                {recipient && (
                    <button
                        onClick={handleToggleBlock}
                        className={`p-1 rounded transition-colors flex-shrink-0 ${blocked ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-destructive"}`}
                        title={blocked ? "Unblock user" : "Block user"}
                    >
                        <Ban className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-center">
                        <div>
                            <Lock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-xs">Start the conversation</p>
                        </div>
                    </div>
                ) : (
                    messages.map(msg => {
                        const isOwn = msg.senderWalletId === wallet.id ||
                            msg.senderWalletId === wallet.signingPublicKey;
                        return (
                            <MessageBubble key={msg.id} msg={msg} isOwn={isOwn} />
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border bg-card/50">
                {sendError && (
                    <div className="px-3 py-1.5 bg-destructive/10 text-destructive text-[10px]">
                        {sendError}
                    </div>
                )}
                {/* Staged media preview */}
                {stagedMedia && (
                    <div className="px-2 pt-2 flex items-center gap-2">
                        <div className="relative rounded border border-border bg-muted/50 max-w-[100px]">
                            {stagedMedia.file.type.startsWith("video/") ? (
                                <div className="flex items-center gap-1 p-1.5">
                                    <Video className="w-3.5 h-3.5 text-primary" />
                                    <span className="text-[10px] truncate max-w-[60px]">{stagedMedia.file.name}</span>
                                </div>
                            ) : (
                                <img src={stagedMedia.previewUrl} alt="Preview" className="max-h-[50px] w-auto rounded" />
                            )}
                            <button
                                onClick={clearStagedMedia}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                            >
                                <X className="w-2.5 h-2.5" />
                            </button>
                        </div>
                        <span className="text-[10px] text-muted-foreground truncate">
                            {(stagedMedia.file.size / 1024).toFixed(0)} KB
                        </span>
                    </div>
                )}

                {/* Spoiler + self-destruct toggles */}
                <div className="px-2 pt-1.5 flex items-center gap-1.5">
                    <button
                        onClick={() => setSpoiler(!spoiler)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${spoiler
                            ? "bg-amber-500/20 text-amber-500"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        <EyeOff className="w-3 h-3" />
                        Spoiler
                    </button>
                    <button
                        onClick={() => setSelfDestruct(!selfDestruct)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${selfDestruct
                            ? "bg-destructive/20 text-destructive"
                            : "text-muted-foreground hover:text-foreground"
                            }`}
                        title="Message deletes 30s after recipient opens it"
                    >
                        <Timer className="w-3 h-3" />
                        {selfDestruct ? "30s" : "Self-destruct"}
                    </button>
                </div>

                <div className="flex items-center gap-2 px-2 py-2">
                    {/* Hidden file input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSending}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                        title="Attach image or video"
                    >
                        <Paperclip className="w-3.5 h-3.5" />
                    </button>
                    <input
                        type="text"
                        placeholder={stagedMedia ? "Caption (optional)..." : "Type a message..."}
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSend()}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                        onClick={handleSend}
                        disabled={(!newMessage.trim() && !stagedMedia) || isSending}
                        className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                        {isSending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Send className="w-3.5 h-3.5" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

type EmbedInfo = { type: "youtube" | "tiktok" | "x" | "instagram" | "spotify" | "soundcloud"; id: string; url: string };

function detectEmbed(text: string): EmbedInfo | null {
    const t = text.trim();
    // YouTube
    let m = t.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (m) return { type: "youtube", id: m[1], url: t };
    // TikTok
    m = t.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
    if (m) return { type: "tiktok", id: m[1], url: t };
    m = t.match(/(?:vm\.tiktok\.com|vt\.tiktok\.com)\/([a-zA-Z0-9]+)/);
    if (m) return { type: "tiktok", id: m[1], url: t };
    // X / Twitter
    m = t.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
    if (m) return { type: "x", id: m[1], url: t };
    // Instagram post/reel
    m = t.match(/instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
    if (m) return { type: "instagram", id: m[1], url: t };
    // Spotify track/album/playlist
    m = t.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
    if (m) return { type: "spotify", id: `${m[1]}/${m[2]}`, url: t };
    // SoundCloud
    if (/soundcloud\.com\/[^/]+\/[^/\s]+/.test(t)) return { type: "soundcloud", id: "", url: t };
    return null;
}

function EmbedCard({ embed, blurred }: { embed: EmbedInfo; blurred: boolean }) {
    const blur = blurred ? "blur-xl" : "";
    switch (embed.type) {
        case "youtube":
            return (
                <iframe
                    src={`https://www.youtube.com/embed/${embed.id}`}
                    className={`w-full rounded aspect-video max-h-[140px] transition-all duration-300 ${blur}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen style={{ border: "none" }}
                />
            );
        case "tiktok":
            return (
                <a href={embed.url} target="_blank" rel="noopener noreferrer"
                   className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/20 border border-white/10 no-underline transition-all ${blur}`}>
                    <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-white">TT</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold opacity-90">TikTok Video</p>
                        <p className="text-[9px] opacity-50 truncate">{embed.url}</p>
                    </div>
                    <span className="text-[10px] opacity-60">▶</span>
                </a>
            );
        case "x":
            return (
                <a href={embed.url} target="_blank" rel="noopener noreferrer"
                   className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-black/20 border border-white/10 no-underline transition-all ${blur}`}>
                    <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-white">𝕏</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold opacity-90">Post on X</p>
                        <p className="text-[9px] opacity-50 truncate">{embed.url}</p>
                    </div>
                    <span className="text-[10px] opacity-60">↗</span>
                </a>
            );
        case "instagram":
            return (
                <a href={embed.url} target="_blank" rel="noopener noreferrer"
                   className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gradient-to-r from-purple-900/20 to-pink-900/20 border border-pink-500/20 no-underline transition-all ${blur}`}>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-white">IG</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold opacity-90">Instagram Post</p>
                        <p className="text-[9px] opacity-50 truncate">{embed.url}</p>
                    </div>
                    <span className="text-[10px] opacity-60">↗</span>
                </a>
            );
        case "spotify":
            return (
                <iframe
                    src={`https://open.spotify.com/embed/${embed.id}?theme=0`}
                    className={`w-full rounded-xl transition-all duration-300 ${blur}`}
                    style={{ border: "none", height: 80 }}
                    allow="encrypted-media"
                />
            );
        case "soundcloud":
            return (
                <a href={embed.url} target="_blank" rel="noopener noreferrer"
                   className={`flex items-center gap-2 px-2 py-1.5 rounded-lg bg-orange-900/20 border border-orange-500/20 no-underline transition-all ${blur}`}>
                    <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-white">SC</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold opacity-90">SoundCloud</p>
                        <p className="text-[9px] opacity-50 truncate">{embed.url}</p>
                    </div>
                    <span className="text-[10px] opacity-60">▶</span>
                </a>
            );
        default:
            return null;
    }
}

function renderLinkedText(text: string): (string | JSX.Element)[] {
    const urlRe = /(https?:\/\/[^\s]+)/g;
    const parts: (string | JSX.Element)[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = urlRe.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index));
        const url = match[1];
        parts.push(
            <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
               className="text-primary underline hover:text-primary/80 break-all">{url}</a>
        );
        last = match.index + url.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length ? parts : [text];
}

// Compact message bubble with media + spoiler support
function MessageBubble({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
    const [revealed, setRevealed] = useState(false);
    const isSpoiler = msg.spoiler && !revealed;

    return (
        <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-1.5 ${isOwn
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted text-foreground rounded-bl-sm"
                }`}>
                {!isOwn && (
                    <p className="text-[10px] font-medium opacity-60 mb-0.5">
                        {msg.senderDisplayName}
                    </p>
                )}

                {/* Content with spoiler support */}
                <div className="relative">
                    {isSpoiler && (
                        <div
                            onClick={() => setRevealed(true)}
                            className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer rounded"
                            style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
                        >
                            <div className="flex items-center gap-1 text-[10px] opacity-70">
                                <EyeOff className="w-3 h-3" />
                                <span>{msg.messageType !== "text" ? "SPOILER" : "Tap to reveal"}</span>
                            </div>
                        </div>
                    )}
                    <div className={isSpoiler ? "select-none" : ""}>
                        {msg.mediaUrl && msg.messageType === "image" ? (
                            <div className="my-1">
                                <img
                                    src={msg.mediaUrl}
                                    alt={msg.mediaFileName || "Image"}
                                    className={`max-w-full rounded max-h-[150px] object-contain transition-all duration-300 ${isSpoiler ? "blur-xl" : ""}`}
                                />
                                {msg.mediaFileName && !isSpoiler && (
                                    <p className="text-[9px] opacity-40 mt-0.5">{msg.mediaFileName}</p>
                                )}
                            </div>
                        ) : msg.mediaUrl && msg.messageType === "video" ? (
                            <div className="my-1">
                                <video
                                    src={isSpoiler ? undefined : msg.mediaUrl}
                                    controls={!isSpoiler}
                                    className={`max-w-full rounded max-h-[150px] transition-all duration-300 ${isSpoiler ? "blur-xl" : ""}`}
                                />
                                {msg.mediaFileName && !isSpoiler && (
                                    <p className="text-[9px] opacity-40 mt-0.5">{msg.mediaFileName}</p>
                                )}
                            </div>
                        ) : msg.plaintext && /^https?:\/\/\S+\.(gif|webp|png|jpe?g)(\?[^\s]*)?$/i.test(msg.plaintext.trim()) ? (
                            <div className="my-1">
                                <img
                                    src={msg.plaintext.trim()}
                                    alt="Image"
                                    className={`max-w-full rounded max-h-[150px] object-contain transition-all duration-300 ${isSpoiler ? "blur-xl" : ""}`}
                                />
                            </div>
                        ) : msg.plaintext && detectEmbed(msg.plaintext.trim()) ? (
                            <div className="my-1">
                                <EmbedCard embed={detectEmbed(msg.plaintext.trim())!} blurred={!!isSpoiler} />
                            </div>
                        ) : (
                            <p className={`text-xs whitespace-pre-wrap break-words transition-all duration-300 ${isSpoiler ? "blur-md" : ""}`}>
                                {msg.plaintext?.startsWith("[Unable") ? (
                                    <span className="italic opacity-60">{msg.plaintext}</span>
                                ) : renderLinkedText(msg.plaintext || "")}
                            </p>
                        )}
                    </div>
                </div>

                <div className={`flex items-center gap-1 mt-0.5 text-[10px] ${isOwn ? "justify-end" : ""}`}>
                    <span className="opacity-50">{formatTime(msg.createdAt)}</span>
                    {msg.spoiler && <EyeOff className="w-2.5 h-2.5 opacity-50" />}
                    {msg.selfDestruct && <Timer className="w-2.5 h-2.5 text-destructive" />}
                    {msg.signatureValid === true ? (
                        <CheckCircle2 className="w-2.5 h-2.5 text-success" />
                    ) : msg.signatureValid === false ? (
                        <XCircle className="w-2.5 h-2.5 text-destructive" />
                    ) : (
                        <Shield className="w-2.5 h-2.5 text-muted-foreground opacity-50" />
                    )}
                </div>
            </div>
        </div>
    );
}

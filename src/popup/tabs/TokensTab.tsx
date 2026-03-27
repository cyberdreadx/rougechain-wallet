import { useState, useEffect, useCallback } from "react";
import {
    Coins, Plus, RefreshCw, Loader2, Download, X, Check, Copy,
    ExternalLink, AlertTriangle, ChevronLeft, Users, Flame, Globe, Shield,
} from "lucide-react";
import type { UnifiedWallet } from "../../lib/unified-wallet";
import { getCoreApiBaseUrl, getCoreApiHeaders } from "../../lib/network";
import {
    getWalletBalance,
    getTokens,
    getTokenMetadata,
    getTokenHolders,
    TOKEN_SYMBOL,
    truncateAddress,
    type WalletBalance,
    type TokenMeta,
    type TokenHoldersInfo,
} from "../../lib/pqc-wallet";
import { invalidate } from "../../lib/api-cache";

const IMPORTED_TOKENS_KEY = "rougechain_imported_tokens";

function loadImportedTokens(): TokenMeta[] {
    try {
        const raw = localStorage.getItem(IMPORTED_TOKENS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        if (parsed.length === 0) return [];
        if (typeof parsed[0] === "string") return parsed.map((s: string) => ({ symbol: s, name: s, creator: "" }));
        return parsed as TokenMeta[];
    } catch { return []; }
}

function saveImportedTokens(tokens: TokenMeta[]) {
    localStorage.setItem(IMPORTED_TOKENS_KEY, JSON.stringify(tokens));
}

function formatSupply(n: number | undefined): string {
    if (n === undefined || n === null) return "—";
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

function TokenAvatar({ meta, size = 32 }: { meta?: TokenMeta | null; size?: number }) {
    const symbol = meta?.symbol || "?";
    const image = meta?.image;
    const cls = `rounded-full flex items-center justify-center font-bold text-xs shrink-0`;

    if (symbol === "XRGE") {
        return <img src="/icons/icon-128.png" alt="XRGE" style={{ width: size, height: size }} className="rounded-full shrink-0" />;
    }
    if (image) {
        return (
            <img
                src={image}
                alt={symbol}
                style={{ width: size, height: size }}
                className="rounded-full shrink-0 object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
        );
    }
    const hue = symbol.split("").reduce((h, c) => h + c.charCodeAt(0) * 37, 0) % 360;
    return (
        <div
            className={cls}
            style={{ width: size, height: size, backgroundColor: `hsl(${hue}, 55%, 25%)`, color: `hsl(${hue}, 80%, 75%)` }}
        >
            {symbol.slice(0, 2)}
        </div>
    );
}

interface Props {
    wallet: UnifiedWallet;
}

export default function TokensTab({ wallet }: Props) {
    const [balances, setBalances] = useState<WalletBalance[]>([]);
    const [allTokens, setAllTokens] = useState<TokenMeta[]>([]);
    const [importedTokens, setImportedTokens] = useState<TokenMeta[]>(loadImportedTokens());
    const [isLoading, setIsLoading] = useState(true);

    // Import flow
    const [showImport, setShowImport] = useState(false);
    const [importSymbol, setImportSymbol] = useState("");
    const [importLoading, setImportLoading] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [importPreview, setImportPreview] = useState<TokenMeta | null>(null);

    // Create flow
    const [showCreate, setShowCreate] = useState(false);
    const [tokenName, setTokenName] = useState("");
    const [tokenSymbol, setTokenSymbol] = useState("");
    const [tokenSupply, setTokenSupply] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [createResult, setCreateResult] = useState<string | null>(null);

    // Detail view
    const [selectedToken, setSelectedToken] = useState<string | null>(null);
    const [holdersInfo, setHoldersInfo] = useState<TokenHoldersInfo | null>(null);
    const [holdersLoading, setHoldersLoading] = useState(false);
    const [creatorCopied, setCreatorCopied] = useState(false);

    const refresh = useCallback(async (showSpinner = true) => {
        if (showSpinner) setIsLoading(true);
        try {
            const [bal, tokens] = await Promise.all([
                getWalletBalance(wallet.signingPublicKey),
                getTokens(),
            ]);
            setBalances(bal);
            setAllTokens(tokens);
        } catch (err) {
            console.error("TokensTab refresh:", err);
        }
        setIsLoading(false);
    }, [wallet.signingPublicKey]);

    useEffect(() => {
        refresh();
        const interval = setInterval(() => refresh(false), 15_000);
        return () => clearInterval(interval);
    }, [refresh]);

    // Migrate old string[] format on first load
    useEffect(() => {
        const raw = localStorage.getItem(IMPORTED_TOKENS_KEY);
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
                Promise.all(
                    (parsed as string[]).map(async (sym) => {
                        const meta = await getTokenMetadata(sym);
                        return meta || { symbol: sym, name: sym, creator: "" };
                    })
                ).then((migrated) => {
                    setImportedTokens(migrated);
                    saveImportedTokens(migrated);
                });
            }
        } catch { /* ignore */ }
    }, []);

    const handleCreate = async () => {
        if (!tokenName || !tokenSymbol || !tokenSupply || isCreating) return;
        setIsCreating(true);
        setCreateResult(null);
        try {
            const baseUrl = getCoreApiBaseUrl();
            if (!baseUrl) throw new Error("No node configured");
            const res = await fetch(`${baseUrl}/token/create`, {
                method: "POST",
                headers: { ...getCoreApiHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    fromPrivateKey: wallet.signingPrivateKey,
                    fromPublicKey: wallet.signingPublicKey,
                    tokenName,
                    tokenSymbol: tokenSymbol.toUpperCase(),
                    initialSupply: parseInt(tokenSupply),
                }),
            });
            const data = await res.json();
            if (data.success) {
                invalidate("tokens");
                invalidate("balance");
                setCreateResult(`Created ${tokenSymbol.toUpperCase()}`);
                setTokenName("");
                setTokenSymbol("");
                setTokenSupply("");
                setShowCreate(false);
                setTimeout(() => { setCreateResult(null); refresh(); }, 2000);
            } else {
                setCreateResult(`Error: ${data.error || "Failed"}`);
            }
        } catch (err: any) {
            setCreateResult(`Error: ${err.message}`);
        }
        setIsCreating(false);
    };

    // --- Import: search & preview ---
    const handleImportSearch = async () => {
        const sym = importSymbol.trim().toUpperCase();
        if (!sym || importLoading) return;
        if (importedTokens.some(t => t.symbol.toUpperCase() === sym)) {
            setImportError("Already imported");
            return;
        }
        setImportLoading(true);
        setImportError(null);
        setImportPreview(null);
        try {
            let meta = allTokens.find(t => t.symbol.toUpperCase() === sym) || null;
            if (!meta) {
                meta = await getTokenMetadata(sym);
            }
            if (!meta) {
                setImportError("Token not found on chain");
            } else {
                setImportPreview(meta);
            }
        } catch {
            setImportError("Failed to look up token");
        }
        setImportLoading(false);
    };

    const confirmImport = () => {
        if (!importPreview) return;
        const updated = [...importedTokens, importPreview];
        setImportedTokens(updated);
        saveImportedTokens(updated);
        setImportPreview(null);
        setImportSymbol("");
        setShowImport(false);
        refresh();
    };

    const handleRemoveImported = (sym: string) => {
        const updated = importedTokens.filter(t => t.symbol.toUpperCase() !== sym.toUpperCase());
        setImportedTokens(updated);
        saveImportedTokens(updated);
    };

    // --- Detail view ---
    const openDetail = async (symbol: string) => {
        setSelectedToken(symbol);
        setHoldersInfo(null);
        setHoldersLoading(true);
        const info = await getTokenHolders(symbol);
        setHoldersInfo(info);
        setHoldersLoading(false);
    };

    const getMetaForSymbol = (sym: string): TokenMeta | undefined =>
        allTokens.find(t => t.symbol.toUpperCase() === sym.toUpperCase()) ||
        importedTokens.find(t => t.symbol.toUpperCase() === sym.toUpperCase());

    const getBalanceForSymbol = (sym: string): number =>
        balances.find(b => b.symbol.toUpperCase() === sym.toUpperCase())?.balance || 0;

    // Build unified token list: tokens with balance + imported tokens
    const myTokens = balances.filter(b => b.balance > 0);
    const importedExtra = importedTokens.filter(
        t => !myTokens.some(b => b.symbol.toUpperCase() === t.symbol.toUpperCase())
    );

    // ==================== DETAIL VIEW ====================
    if (selectedToken) {
        const meta = getMetaForSymbol(selectedToken);
        const bal = getBalanceForSymbol(selectedToken);
        const isImported = importedTokens.some(t => t.symbol.toUpperCase() === selectedToken.toUpperCase());

        return (
            <div className="flex flex-col h-full overflow-y-auto">
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                    <button onClick={() => setSelectedToken(null)} className="text-muted-foreground hover:text-foreground">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-semibold text-foreground">Token Details</span>
                </div>

                {/* Hero */}
                <div className="flex flex-col items-center py-4 border-b border-border">
                    <TokenAvatar meta={meta} size={48} />
                    <h2 className="text-base font-bold text-foreground mt-2">{meta?.name || selectedToken}</h2>
                    <p className="text-xs text-muted-foreground">{selectedToken}</p>
                    <p className="text-xl font-bold text-foreground mt-2 font-mono">
                        {bal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{selectedToken} balance</p>
                </div>

                {/* Stats */}
                <div className="p-3 border-b border-border">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Supply Info</p>
                    {holdersLoading ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : holdersInfo ? (
                        <div className="grid grid-cols-2 gap-2">
                            <StatCard icon={<Coins className="w-3 h-3" />} label="Total Supply" value={formatSupply(holdersInfo.total_supply)} />
                            <StatCard icon={<RefreshCw className="w-3 h-3" />} label="Circulating" value={formatSupply(holdersInfo.circulating_supply)} />
                            <StatCard icon={<Users className="w-3 h-3" />} label="Holders" value={String(holdersInfo.holders.length)} />
                            <StatCard icon={<Flame className="w-3 h-3" />} label="Burned" value={formatSupply(holdersInfo.burned_supply)} />
                            {holdersInfo.shielded_supply > 0 && (
                                <StatCard icon={<Shield className="w-3 h-3" />} label="Shielded" value={formatSupply(holdersInfo.shielded_supply)} />
                            )}
                        </div>
                    ) : (
                        <p className="text-[10px] text-muted-foreground">Unable to load stats</p>
                    )}
                </div>

                {/* Token info */}
                {meta && (
                    <div className="p-3 border-b border-border space-y-2">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Token Info</p>

                        {meta.creator && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">Creator</span>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(meta.creator);
                                        setCreatorCopied(true);
                                        setTimeout(() => setCreatorCopied(false), 1500);
                                    }}
                                    className="flex items-center gap-1 text-[10px] font-mono text-foreground hover:text-primary transition-colors"
                                >
                                    {truncateAddress(meta.creator)}
                                    {creatorCopied ? <Check className="w-2.5 h-2.5 text-success" /> : <Copy className="w-2.5 h-2.5" />}
                                </button>
                            </div>
                        )}

                        {meta.description && (
                            <div>
                                <span className="text-[10px] text-muted-foreground">Description</span>
                                <p className="text-xs text-foreground mt-0.5">{meta.description}</p>
                            </div>
                        )}

                        {meta.created_at && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">Created</span>
                                <span className="text-[10px] text-foreground">{new Date(meta.created_at).toLocaleDateString()}</span>
                            </div>
                        )}

                        {meta.frozen !== undefined && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">Frozen</span>
                                <span className={`text-[10px] ${meta.frozen ? "text-destructive" : "text-success"}`}>{meta.frozen ? "Yes" : "No"}</span>
                            </div>
                        )}

                        {meta.mintable !== undefined && (
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-muted-foreground">Mintable</span>
                                <span className="text-[10px] text-foreground">{meta.mintable ? "Yes" : "No"}</span>
                            </div>
                        )}

                        {/* Links */}
                        <div className="flex gap-2 pt-1">
                            {meta.website && (
                                <a href={meta.website} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-[10px] text-foreground hover:bg-secondary transition-colors">
                                    <Globe className="w-3 h-3" /> Website
                                </a>
                            )}
                            {meta.twitter && (
                                <a href={meta.twitter.startsWith("http") ? meta.twitter : `https://x.com/${meta.twitter}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-[10px] text-foreground hover:bg-secondary transition-colors">
                                    <ExternalLink className="w-3 h-3" /> X
                                </a>
                            )}
                            {meta.discord && (
                                <a href={meta.discord.startsWith("http") ? meta.discord : `https://discord.gg/${meta.discord}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-[10px] text-foreground hover:bg-secondary transition-colors">
                                    <ExternalLink className="w-3 h-3" /> Discord
                                </a>
                            )}
                        </div>
                    </div>
                )}

                {/* Top holders */}
                {holdersInfo && holdersInfo.holders.length > 0 && (
                    <div className="p-3 border-b border-border">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Top Holders</p>
                        <div className="space-y-1">
                            {holdersInfo.holders.slice(0, 5).map((h, i) => (
                                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-secondary/20">
                                    <span className="text-[10px] font-mono text-foreground truncate max-w-[140px]">
                                        {truncateAddress(h.address)}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono text-foreground">{formatSupply(h.balance)}</span>
                                        <span className="text-[9px] text-muted-foreground w-10 text-right">{h.percentage.toFixed(1)}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Remove imported */}
                {isImported && (
                    <div className="p-3">
                        <button
                            onClick={() => { handleRemoveImported(selectedToken); setSelectedToken(null); }}
                            className="w-full py-2 rounded-lg bg-destructive/20 text-destructive text-xs font-medium hover:bg-destructive/30 transition-colors flex items-center justify-center gap-1.5"
                        >
                            <X className="w-3.5 h-3.5" /> Remove Token
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // ==================== MAIN LIST VIEW ====================
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold text-foreground">Tokens</span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => { setShowImport(!showImport); setShowCreate(false); setImportPreview(null); setImportError(null); setImportSymbol(""); }}
                        title="Import Token"
                        className={`hover:text-primary/80 transition-colors ${showImport ? "text-primary" : "text-muted-foreground"}`}
                    >
                        <Download className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => { setShowCreate(!showCreate); setShowImport(false); }}
                        title="Create Token"
                        className={`hover:text-primary/80 transition-colors ${showCreate ? "text-primary" : "text-muted-foreground"}`}
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                    <button onClick={() => refresh()} className="text-muted-foreground hover:text-primary transition-colors">
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                    </button>
                </div>
            </div>

            {createResult && (
                <div className={`px-4 py-2 text-xs ${createResult.startsWith("Error") ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                    {createResult}
                </div>
            )}

            {/* ========= IMPORT PANEL ========= */}
            {showImport && (
                <div className="p-3 border-b border-border bg-card/80 space-y-2">
                    <p className="text-xs font-medium text-foreground">Import Token</p>

                    {!importPreview ? (
                        <>
                            <p className="text-[10px] text-muted-foreground">
                                Enter the symbol of a token on RougeChain.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    placeholder="Token symbol (e.g. QSHIB)"
                                    value={importSymbol}
                                    onChange={e => { setImportSymbol(e.target.value.toUpperCase()); setImportError(null); }}
                                    maxLength={20}
                                    onKeyDown={e => e.key === "Enter" && handleImportSearch()}
                                    className="flex-1 px-3 py-2 rounded-lg bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                    onClick={handleImportSearch}
                                    disabled={!importSymbol.trim() || importLoading}
                                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {importLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
                                </button>
                            </div>
                            {importError && (
                                <p className="text-[10px] text-destructive">{importError}</p>
                            )}
                        </>
                    ) : (
                        /* --- Preview card --- */
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/30 border border-border">
                                <TokenAvatar meta={importPreview} size={40} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-foreground">{importPreview.name}</p>
                                    <p className="text-[10px] text-muted-foreground">{importPreview.symbol}</p>
                                    {importPreview.total_minted !== undefined && (
                                        <p className="text-[10px] text-muted-foreground">
                                            Supply: {formatSupply(importPreview.total_minted)}
                                        </p>
                                    )}
                                    {importPreview.creator && (
                                        <p className="text-[9px] text-muted-foreground font-mono">
                                            Creator: {truncateAddress(importPreview.creator)}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {importPreview.description && (
                                <p className="text-[10px] text-muted-foreground px-1">{importPreview.description}</p>
                            )}

                            <div className="flex items-start gap-2 p-2 rounded-lg bg-warning/10 border border-warning/20">
                                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                                <p className="text-[10px] text-warning">
                                    Anyone can create a token with any name. Make sure this is the token you want before importing.
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setImportPreview(null); setImportSymbol(""); }}
                                    className="flex-1 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmImport}
                                    className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1"
                                >
                                    <Check className="w-3.5 h-3.5" /> Import
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ========= CREATE PANEL ========= */}
            {showCreate && (
                <div className="p-3 border-b border-border bg-card/80 space-y-2">
                    <p className="text-xs font-medium text-foreground">Create Token</p>
                    <input
                        placeholder="Token name (e.g. My Token)"
                        value={tokenName}
                        onChange={e => setTokenName(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                        placeholder="Symbol (e.g. MTK)"
                        value={tokenSymbol}
                        onChange={e => setTokenSymbol(e.target.value.toUpperCase())}
                        maxLength={10}
                        className="w-full px-3 py-2 rounded-lg bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                        type="number"
                        placeholder="Total supply"
                        value={tokenSupply}
                        onChange={e => setTokenSupply(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Fee: 10 XRGE</p>
                    <button
                        onClick={handleCreate}
                        disabled={!tokenName || !tokenSymbol || !tokenSupply || isCreating}
                        className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Create Token"}
                    </button>
                </div>
            )}

            {/* ========= TOKEN LIST ========= */}
            <div className="flex-1 overflow-y-auto">
                {isLoading && balances.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <div className="px-3 py-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Your Tokens</p>
                            {myTokens.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <Coins className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                    <p className="text-xs">No tokens yet</p>
                                    <p className="text-[10px] mt-1">Use the faucet or create a token</p>
                                </div>
                            ) : (
                                <div className="space-y-0.5">
                                    {myTokens.map(b => {
                                        const meta = getMetaForSymbol(b.symbol);
                                        return (
                                            <button
                                                key={b.symbol}
                                                onClick={() => openDetail(b.symbol)}
                                                className="flex items-center justify-between w-full py-2.5 px-3 rounded-lg hover:bg-secondary/30 active:bg-secondary/50 transition-colors text-left"
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <TokenAvatar meta={meta || { symbol: b.symbol, name: b.name, creator: "" }} />
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-semibold text-foreground">{b.symbol}</p>
                                                        <p className="text-[10px] text-muted-foreground truncate">{meta?.name || b.name}</p>
                                                    </div>
                                                </div>
                                                <span className="text-xs font-mono text-foreground tabular-nums">
                                                    {b.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {importedExtra.length > 0 && (
                            <div className="px-3 py-2 border-t border-border">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Imported</p>
                                <div className="space-y-0.5">
                                    {importedExtra.map(t => (
                                        <div key={t.symbol} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors">
                                            <button
                                                onClick={() => openDetail(t.symbol)}
                                                className="flex items-center gap-2.5 min-w-0 text-left flex-1"
                                            >
                                                <TokenAvatar meta={t} />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-semibold text-foreground">{t.symbol}</p>
                                                    <p className="text-[10px] text-muted-foreground truncate">{t.name}</p>
                                                </div>
                                            </button>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono text-muted-foreground">0</span>
                                                <button
                                                    onClick={() => handleRemoveImported(t.symbol)}
                                                    title="Remove"
                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20">
            <div className="text-muted-foreground">{icon}</div>
            <div className="min-w-0">
                <p className="text-[9px] text-muted-foreground">{label}</p>
                <p className="text-[11px] font-mono font-medium text-foreground">{value}</p>
            </div>
        </div>
    );
}

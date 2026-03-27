import { useState } from "react";
import { Loader2, Plus, Upload, KeyRound, Eye, EyeOff, Copy, Check, ShieldAlert, ArrowRight, Lock } from "lucide-react";
import { generateEncryptionKeypair, registerWalletOnNode } from "../../lib/pqc-messenger";
import { saveUnifiedWallet, lockUnifiedWallet, type UnifiedWallet } from "../../lib/unified-wallet";
import { generateMnemonic, keypairFromMnemonic } from "../../lib/mnemonic";
import { reverseLookup } from "../../lib/pqc-mail";

interface Props {
    onCreated: (wallet: UnifiedWallet) => void;
}

export default function CreateWalletScreen({ onCreated }: Props) {
    const [name, setName] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [showImport, setShowImport] = useState(false);

    const [backupWallet, setBackupWallet] = useState<UnifiedWallet | null>(null);
    const [seedRevealed, setSeedRevealed] = useState(false);
    const [seedCopied, setSeedCopied] = useState(false);

    // Password setup step
    const [showPasswordStep, setShowPasswordStep] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordError, setPasswordError] = useState("");
    const [isLocking, setIsLocking] = useState(false);

    const handleCreate = async () => {
        if (!name.trim() || isCreating) return;
        setIsCreating(true);

        try {
            const mnemonic = generateMnemonic();
            const { publicKey, secretKey } = keypairFromMnemonic(mnemonic);
            const encKeypair = generateEncryptionKeypair();
            const id = crypto.randomUUID();

            const wallet: UnifiedWallet = {
                id,
                displayName: name.trim(),
                createdAt: Date.now(),
                signingPublicKey: publicKey,
                signingPrivateKey: secretKey,
                encryptionPublicKey: encKeypair.publicKey,
                encryptionPrivateKey: encKeypair.privateKey,
                version: 3,
                mnemonic,
            };

            saveUnifiedWallet(wallet);

            try {
                await registerWalletOnNode({
                    id: wallet.id,
                    displayName: wallet.displayName,
                    signingPublicKey: wallet.signingPublicKey,
                    encryptionPublicKey: wallet.encryptionPublicKey,
                });
            } catch { /* Node may be unavailable — that's okay */ }

            setBackupWallet(wallet);
        } catch (err) {
            console.error("Wallet creation failed:", err);
        }
        setIsCreating(false);
    };

    const copySeed = () => {
        if (!backupWallet?.mnemonic) return;
        navigator.clipboard.writeText(backupWallet.mnemonic);
        setSeedCopied(true);
        setTimeout(() => setSeedCopied(false), 2000);
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const wallet = JSON.parse(text) as UnifiedWallet;
            if (!wallet.signingPublicKey || !wallet.signingPrivateKey) {
                alert("Invalid wallet file");
                return;
            }
            saveUnifiedWallet(wallet);
            setBackupWallet(wallet);
            setShowPasswordStep(true);
        } catch {
            alert("Failed to import wallet");
        }
    };

    const [showSeedImport, setShowSeedImport] = useState(false);
    const [seedPhrase, setSeedPhrase] = useState("");
    const [seedError, setSeedError] = useState("");
    const [isRecovering, setIsRecovering] = useState(false);

    const handleSeedRecover = async () => {
        const trimmed = seedPhrase.trim().toLowerCase();
        const words = trimmed.split(/\s+/);
        if (words.length !== 12 && words.length !== 24) {
            setSeedError("Seed phrase must be 12 or 24 words");
            return;
        }
        const { validateMnemonic: validate, keypairFromMnemonic: recover } = await import("../../lib/mnemonic");
        if (!validate(trimmed)) {
            setSeedError("Invalid seed phrase — check for typos");
            return;
        }
        setSeedError("");
        setIsRecovering(true);
        try {
            const { publicKey, secretKey } = recover(trimmed);
            const { generateEncryptionKeypair } = await import("../../lib/pqc-messenger");
            const encKeypair = generateEncryptionKeypair();

            let resolvedName = name.trim();
            if (!resolvedName) {
                try {
                    const nodeName = await reverseLookup(publicKey);
                    if (nodeName) resolvedName = nodeName;
                } catch { /* node may be unreachable */ }
            }

            const wallet: UnifiedWallet = {
                id: crypto.randomUUID(),
                displayName: resolvedName || "Recovered Wallet",
                createdAt: Date.now(),
                signingPublicKey: publicKey,
                signingPrivateKey: secretKey,
                encryptionPublicKey: encKeypair.publicKey,
                encryptionPrivateKey: encKeypair.privateKey,
                version: 3,
                mnemonic: trimmed,
            };
            saveUnifiedWallet(wallet);
            setBackupWallet(wallet);
            setShowPasswordStep(true);
        } catch (err) {
            console.error("Recovery failed:", err);
            setSeedError("Recovery failed — please try again");
        }
        setIsRecovering(false);
    };

    if (backupWallet) {
        const words = backupWallet.mnemonic?.split(" ") || [];
        return (
            <div className="flex flex-col items-center h-full p-6 bg-background overflow-y-auto">
                <ShieldAlert className="w-10 h-10 text-warning mb-3" />
                <h1 className="text-lg font-bold text-foreground mb-1">Back Up Your Seed Phrase</h1>
                <p className="text-[11px] text-muted-foreground text-center mb-4 max-w-xs">
                    This is the <span className="text-warning font-semibold">only way</span> to recover your wallet.
                    Write it down and store it somewhere safe. Never share it.
                </p>

                <div
                    className="relative w-full max-w-xs rounded-xl border border-border bg-card p-3 cursor-pointer select-none"
                    onClick={() => !seedRevealed && setSeedRevealed(true)}
                >
                    {!seedRevealed && (
                        <div className="absolute inset-0 rounded-xl bg-card/80 backdrop-blur-md flex flex-col items-center justify-center gap-2 z-10">
                            <EyeOff className="w-6 h-6 text-warning" />
                            <span className="text-xs font-medium text-warning">Click to reveal</span>
                            <span className="text-[10px] text-muted-foreground">Make sure no one is watching</span>
                        </div>
                    )}
                    <div className={`grid grid-cols-3 gap-1.5 ${!seedRevealed ? "blur-lg" : ""} transition-all duration-300`}>
                        {words.map((word, i) => (
                            <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 text-[10px] font-mono">
                                <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                                <span className="text-foreground">{word}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="w-full max-w-xs space-y-2 mt-4">
                    <button
                        onClick={copySeed}
                        disabled={!seedRevealed}
                        className={`w-full py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                            seedCopied
                                ? "bg-success/20 text-success"
                                : seedRevealed
                                    ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                                    : "bg-secondary/30 text-muted-foreground cursor-not-allowed"
                        }`}
                    >
                        {seedCopied ? <><Check className="w-4 h-4" /> Copied to clipboard</> : <><Copy className="w-4 h-4" /> Copy Seed Phrase</>}
                    </button>

                    <button
                        onClick={() => setShowPasswordStep(true)}
                        disabled={!seedRevealed}
                        className={`w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                            seedRevealed
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : "bg-primary/30 text-primary-foreground/50 cursor-not-allowed"
                        }`}
                    >
                        I've saved my seed phrase <ArrowRight className="w-4 h-4" />
                    </button>
                </div>

                <p className="text-[9px] text-destructive/70 text-center mt-3 max-w-xs">
                    If you lose this phrase, your wallet cannot be recovered.
                    RougeChain cannot help you retrieve it.
                </p>
            </div>
        );
    }

    // ─── Password setup step ───
    if (showPasswordStep && backupWallet) {
        const handleSetPassword = async () => {
            if (password.length < 6) {
                setPasswordError("Password must be at least 6 characters");
                return;
            }
            if (password !== confirmPassword) {
                setPasswordError("Passwords don't match");
                return;
            }
            setPasswordError("");
            setIsLocking(true);
            try {
                saveUnifiedWallet(backupWallet);
                await lockUnifiedWallet(password);
                onCreated(backupWallet);
            } catch (err) {
                console.error("Failed to set password:", err);
                setPasswordError("Failed to encrypt wallet");
            }
            setIsLocking(false);
        };

        return (
            <div className="flex flex-col items-center justify-center h-full p-6 bg-background">
                <Lock className="w-10 h-10 text-primary mb-3" />
                <h1 className="text-lg font-bold text-foreground mb-1">Set a Password</h1>
                <p className="text-[11px] text-muted-foreground text-center mb-6 max-w-xs">
                    Your password encrypts the wallet on this device. You'll need it to unlock the extension.
                </p>

                <div className="w-full max-w-xs space-y-3">
                    <input
                        type="password"
                        placeholder="Create password (min 6 characters)"
                        value={password}
                        onChange={e => { setPassword(e.target.value); setPasswordError(""); }}
                        className="w-full px-4 py-2.5 rounded-xl bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <input
                        type="password"
                        placeholder="Confirm password"
                        value={confirmPassword}
                        onChange={e => { setConfirmPassword(e.target.value); setPasswordError(""); }}
                        onKeyDown={e => e.key === "Enter" && handleSetPassword()}
                        className="w-full px-4 py-2.5 rounded-xl bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />

                    {passwordError && (
                        <p className="text-[10px] text-destructive text-center">{passwordError}</p>
                    )}

                    <button
                        onClick={handleSetPassword}
                        disabled={!password || !confirmPassword || isLocking}
                        className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {isLocking ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Encrypting...</>
                        ) : (
                            <><Lock className="w-4 h-4" /> Set Password & Continue</>
                        )}
                    </button>
                </div>

                <p className="text-[9px] text-muted-foreground text-center mt-4 max-w-xs">
                    Your password is never sent anywhere. It's used locally to encrypt your private keys with AES-256-GCM.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full p-6 bg-background">
            <div className="logo-ring w-16 h-16 mb-4">
                <img src="/xrge-logo.webp" alt="XRGE" />
            </div>

            <h1 className="text-lg font-bold text-gradient-quantum mb-1">RougeChain Wallet</h1>
            <p className="text-xs text-muted-foreground text-center mb-6">
                Quantum-safe cryptocurrency wallet<br />
                powered by ML-DSA-65 & ML-KEM-768
            </p>

            <div className="w-full max-w-xs space-y-3">
                <input
                    type="text"
                    placeholder="Wallet name (e.g. My Wallet)"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                    className="w-full px-4 py-2.5 rounded-xl bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />

                <button
                    onClick={handleCreate}
                    disabled={!name.trim() || isCreating}
                    className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                    {isCreating ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Generating keys...</>
                    ) : (
                        <><Plus className="w-4 h-4" /> Create Wallet</>
                    )}
                </button>

                <div className="relative flex items-center gap-2 py-2">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] text-muted-foreground">or recover</span>
                    <div className="flex-1 h-px bg-border" />
                </div>

                {/* Seed phrase recovery */}
                {showSeedImport ? (
                    <div className="space-y-2">
                        <textarea
                            placeholder="Enter your 24-word recovery phrase..."
                            value={seedPhrase}
                            onChange={e => { setSeedPhrase(e.target.value); setSeedError(""); }}
                            rows={3}
                            className="w-full px-3 py-2 rounded-xl bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none font-mono"
                        />
                        {seedError && (
                            <p className="text-[10px] text-destructive">{seedError}</p>
                        )}
                        <button
                            onClick={handleSeedRecover}
                            disabled={!seedPhrase.trim() || isRecovering}
                            className="w-full py-2 rounded-xl bg-warning/20 text-warning text-sm font-medium hover:bg-warning/30 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                        >
                            {isRecovering ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Recovering...</>
                            ) : (
                                "Recover Wallet"
                            )}
                        </button>
                        <button
                            onClick={() => { setShowSeedImport(false); setSeedError(""); setSeedPhrase(""); }}
                            className="w-full py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <button
                            onClick={() => setShowSeedImport(true)}
                            className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2"
                        >
                            <KeyRound className="w-4 h-4" /> Import from Seed Phrase
                        </button>
                        <label className="w-full py-2.5 rounded-xl bg-secondary/50 text-secondary-foreground text-sm font-medium hover:bg-secondary/60 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                            <Upload className="w-4 h-4" /> Import JSON File
                            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                        </label>
                    </div>
                )}
            </div>

            <p className="text-[10px] text-muted-foreground text-center mt-6 max-w-xs">
                Your private keys never leave this device.
                NIST-approved post-quantum cryptography (FIPS 203 & 204).
            </p>
        </div>
    );
}

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface VaultEntry {
    id?: number;
    uuid: string;
    username?: string;
    password?: string;
    totpSecret?: string;
    notes?: string;
}

interface DashboardProps {
    onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
    const [view, setView] = useState<"home" | "add" | "detail" | "sync">("home");
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<VaultEntry>({ uuid: "" });
    const [totpCode, setTotpCode] = useState("------");
    const [timeLeft, setTimeLeft] = useState(30);
    const [highlightedUuid, setHighlightedUuid] = useState<string | null>(null);
    const [showTotpSecret, setShowTotpSecret] = useState(false);

    useEffect(() => {
        refreshVault();
    }, []);

    // Clear highlight after animation
    useEffect(() => {
        if (highlightedUuid) {
            const timer = setTimeout(() => setHighlightedUuid(null), 1500);
            return () => clearTimeout(timer);
        }
    }, [highlightedUuid]);

    // TOTP Timer Logic
    useEffect(() => {
        let interval: any;
        if (view === "detail" && currentEntry.totpSecret) {
            const fetchCode = () => {
                invoke<string>("get_totp_token", { secret: currentEntry.totpSecret })
                    .then((code) => setTotpCode(code))
                    .catch(() => setTotpCode("Error"));
            };
            fetchCode();
            interval = setInterval(() => {
                const sec = 30 - (Math.floor(Date.now() / 1000) % 30);
                setTimeLeft(sec);
                if (sec === 30) fetchCode();
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [view, currentEntry.totpSecret]);

    async function refreshVault() {
        try {
            const rawData = await invoke<any[]>("get_all_vault_entries");
            const parsed = rawData.map((e: any) => {
                try {
                    const jsonString = String.fromCharCode(...e.data_blob);
                    const data = JSON.parse(jsonString);
                    return { id: e.id, uuid: e.uuid, ...data };
                } catch {
                    return { id: e.id, uuid: e.uuid };
                }
            });
            setEntries(parsed);
        } catch {
            // Failed to load vault entries
        }
    }

    async function handleSave() {
        try {
            // Validate Site Name
            if (!currentEntry.uuid || currentEntry.uuid.trim() === "") {
                alert("Site Name is required.");
                return;
            }

            // Validate TOTP secret format if provided (Base32: A-Z, 2-7 only)
            if (currentEntry.totpSecret) {
                const cleanSecret = currentEntry.totpSecret.replace(/[\s=]/g, "").toUpperCase();
                const base32Regex = /^[A-Z2-7]+$/;
                if (!base32Regex.test(cleanSecret)) {
                    alert("Invalid TOTP secret key. Only Base32 characters are allowed (A-Z and 2-7).");
                    return;
                }
                // Also validate with backend
                try {
                    await invoke<string>("get_totp_token", { secret: currentEntry.totpSecret });
                } catch {
                    alert("Invalid TOTP secret key. Please enter a valid Base32 encoded secret.");
                    return;
                }
            }

            const payload = {
                username: currentEntry.username,
                password: currentEntry.password,
                totpSecret: currentEntry.totpSecret,
                notes: currentEntry.notes
            };
            const jsonStr = JSON.stringify(payload);
            const blob = Array.from(new TextEncoder().encode(jsonStr));

            const isNewEntry = !currentEntry.id;
            const savedUuid = currentEntry.uuid;

            if (currentEntry.id) {
                await invoke("update_entry", { id: currentEntry.id, uuid: currentEntry.uuid, blob, nonce: [] });
            } else {
                await invoke("save_entry", { uuid: currentEntry.uuid, blob, nonce: [] });
            }

            await refreshVault();
            setShowTotpSecret(false);

            if (isNewEntry) {
                setHighlightedUuid(savedUuid);
                setCurrentEntry({ uuid: "" });
                setView("home");
            }
        } catch (e) {
            alert("Save Failed: " + e);
        }
    }

    // --- STYLES ---
    const inputStyle = { width: "100%", padding: "12px", background: "#333", border: "none", color: "white", borderRadius: "6px", marginBottom: "15px", boxSizing: "border-box" as const };
    const sidebarBtnStyle = (active: boolean) => ({
        background: active ? "rgba(138, 43, 226, 0.3)" : "transparent", padding: "10px", borderRadius: "10px", border: "none", fontSize: "24px", cursor: "pointer", marginBottom: "10px"
    });

    return (
        <div style={{ display: "flex", height: "100vh", background: "#1a1a1a", color: "white", fontFamily: "sans-serif" }}>
            {/* Sidebar */}
            <div style={{ width: "70px", background: "#111", padding: "20px 0", display: "flex", flexDirection: "column", alignItems: "center", borderRight: "1px solid #333" }}>
                <button onClick={() => setView("home")} style={sidebarBtnStyle(view === "home")}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={view === "home" ? "#fff" : "#888"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    </svg>
                </button>
                <button onClick={() => setView("add")} style={sidebarBtnStyle(view === "add" || view === "detail")}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={view === "add" || view === "detail" ? "#fff" : "#888"} strokeWidth="1.5" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                </button>
                <div style={{ flexGrow: 1 }}></div>
                <button onClick={() => setView("sync")} style={sidebarBtnStyle(view === "sync")}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={view === "sync" ? "#fff" : "#888"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6M1 20v-6h6"/>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                </button>
                <button onClick={onLogout} style={{ ...sidebarBtnStyle(false), marginTop: "10px" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                </button>
            </div>

            {/* Content */}
            <div style={{ flexGrow: 1, padding: "40px", overflowY: "auto" }}>
                {view === "home" && (
                    <>
                        <h1>My Vault</h1>
                        <input placeholder="Search..." style={inputStyle} />
                        {entries.map(e => (
                            <div
                                key={e.id}
                                onClick={() => { setCurrentEntry(e); setShowTotpSecret(false); setView("detail"); }}
                                style={{
                                    padding: "15px",
                                    background: highlightedUuid === e.uuid ? "rgba(138, 43, 226, 0.3)" : "#252525",
                                    marginBottom: "10px",
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    border: highlightedUuid === e.uuid ? "1px solid rgba(138, 43, 226, 0.6)" : "1px solid #333",
                                    transition: "all 0.5s ease-out"
                                }}
                            >
                                <strong>{e.uuid}</strong>
                            </div>
                        ))}
                    </>
                )}

                {(view === "add" || view === "detail") && (
                    <form
                        style={{ maxWidth: "500px" }}
                        onSubmit={(e) => { e.preventDefault(); handleSave(); }}
                    >
                        <button
                            type="button"
                            onClick={() => { setCurrentEntry({ uuid: "" }); setShowTotpSecret(false); setView("home"); }}
                            style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: "0", marginBottom: "20px", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5M12 19l-7-7 7-7"/>
                            </svg>
                            Back
                        </button>
                        {view === "add" ? (
                            <>
                                <h2 style={{ marginTop: "0" }}>Add Entry</h2>
                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Site Name</label>
                                    <input value={currentEntry.uuid} onChange={e => setCurrentEntry({ ...currentEntry, uuid: e.target.value })} style={inputStyle} autoFocus />
                                </div>
                            </>
                        ) : (
                            <input
                                value={currentEntry.uuid}
                                onChange={e => setCurrentEntry({ ...currentEntry, uuid: e.target.value })}
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    borderBottom: "1px solid transparent",
                                    color: "white",
                                    fontSize: "1.5em",
                                    fontWeight: "bold",
                                    padding: "0",
                                    marginTop: "0",
                                    marginBottom: "20px",
                                    width: "100%",
                                    outline: "none"
                                }}
                                onFocus={(e) => e.target.style.borderBottom = "1px solid #555"}
                                onBlur={(e) => e.target.style.borderBottom = "1px solid transparent"}
                            />
                        )}

                        <div style={{ marginBottom: "8px" }}>
                            <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Username</label>
                            <input value={currentEntry.username || ""} onChange={e => setCurrentEntry({ ...currentEntry, username: e.target.value })} style={inputStyle} />
                        </div>

                        <div style={{ marginBottom: "8px" }}>
                            <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Password</label>
                            <input type="password" value={currentEntry.password || ""} onChange={e => setCurrentEntry({ ...currentEntry, password: e.target.value })} style={inputStyle} />
                        </div>

                        <div style={{ marginBottom: "8px" }}>
                            <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                {view === "detail" ? "Verification Code" : "TOTP Secret"} <span style={{ color: "#555", textTransform: "none" }}>(Optional)</span>
                            </label>
                            {view === "add" || showTotpSecret ? (
                                <input placeholder="e.g. JBSWY3DPEHPK3PXP" value={currentEntry.totpSecret || ""} onChange={e => setCurrentEntry({ ...currentEntry, totpSecret: e.target.value })} style={inputStyle} />
                            ) : currentEntry.totpSecret ? (
                                <>
                                    <div style={{ fontSize: "32px", color: "#8A2BE2", fontFamily: "monospace", marginBottom: "8px" }}>
                                        {totpCode} <span style={{ fontSize: "14px", color: "#555" }}>({timeLeft}s)</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowTotpSecret(true)}
                                        style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: "0", fontSize: "12px" }}
                                    >
                                        Edit secret key
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setShowTotpSecret(true)}
                                    style={{ background: "none", border: "1px dashed #444", color: "#555", cursor: "pointer", padding: "12px", borderRadius: "6px", width: "100%", fontSize: "14px" }}
                                >
                                    + Add verification code
                                </button>
                            )}
                        </div>

                        <div style={{ marginBottom: "8px" }}>
                            <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Notes <span style={{ color: "#555", textTransform: "none" }}>(Optional)</span></label>
                            <textarea rows={4} value={currentEntry.notes || ""} onChange={e => setCurrentEntry({ ...currentEntry, notes: e.target.value })} style={inputStyle} />
                        </div>

                        <button type="submit" style={{ width: "100%", padding: "15px", background: "#8A2BE2", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", fontSize: "16px", cursor: "pointer" }}>Save</button>
                    </form>
                )}

                {view === "sync" && (
                    <div style={{ maxWidth: "500px" }}>
                        <button
                            onClick={() => setView("home")}
                            style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: "0", marginBottom: "20px", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5M12 19l-7-7 7-7"/>
                            </svg>
                            Back
                        </button>
                        <h2 style={{ marginTop: "0" }}>Sync</h2>
                        <p style={{ color: "#888" }}>Sync functionality coming soon.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

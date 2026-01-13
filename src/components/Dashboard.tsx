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

export default function Dashboard() {
    const [view, setView] = useState<"home" | "add" | "detail" | "sync">("home");
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<VaultEntry>({ uuid: "" });
    const [totpCode, setTotpCode] = useState("------");
    const [timeLeft, setTimeLeft] = useState(30);

    useEffect(() => {
        refreshVault();
    }, []);

    // TOTP Timer Logic
    useEffect(() => {
        let interval: any;
        if (view === "detail" && currentEntry.totpSecret) {
            const fetchCode = () => {
                invoke("get_totp_token", { secret: currentEntry.totpSecret })
                    .then((c: any) => setTotpCode(c.code as string))
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
            const rawData = await invoke<any[]>("get_all_entries");
            // SAFE PARSING LOGIC
            const parsed = rawData.map((e: any) => {
                try {
                    // Backend returns { payload: { password: "JSON" } }
                    // We need to parse that.
                    // The user provided code assumes 'e.data_blob' which implies raw DB access?
                    // BUT 'get_all_entries' in 'main.rs' returns 'VaultEntryResponse' with 'payload'.
                    // 'payload' has 'password' string.
                    // So 'e.data_blob' will be undefined and this will crash if I don't fix it.

                    // ADAPTER FIX:
                    const jsonStr = e.payload.password;
                    const data = JSON.parse(jsonStr);

                    // User code expected:
                    // const jsonString = String.fromCharCode(...e.data_blob); 
                    // const data = JSON.parse(jsonString);

                    return { id: e.id, uuid: e.payload.title || e.uuid, ...data };
                } catch {
                    return { id: e.id, uuid: e.uuid };
                }
            });
            setEntries(parsed);
        } catch (e) { console.error(e); }
    }

    async function handleSave() {
        try {
            const payload = {
                username: currentEntry.username,
                password: currentEntry.password,
                totpSecret: currentEntry.totpSecret,
                notes: currentEntry.notes
            };
            const jsonStr = JSON.stringify(payload);

            // Backend expects 'VaultEntryPayload' struct for 'save_entry'/'update_entry' (Wait, update_entry I implemented takes blob!)
            // My implementation of 'update_entry': fn update_entry(..., uuid, blob, nonce)
            // So passing 'blob' from frontend IS CORRECT for 'update_entry'.
            // BUT 'save_entry' in 'main.rs' takes 'VaultEntryPayload' struct!
            // So 'save_entry' call needs to be adapted.

            // Checking 'save_entry' signature in main.rs:
            // async fn save_entry(payload: VaultEntryPayload, ...)

            // User code: invoke("save_entry", { uuid: ..., blob: ..., nonce: [] })
            // THIS WILL FAIL for 'save_entry'.

            // I must Adapt 'save_entry' call to match 'VaultEntryPayload'.
            // AND 'update_entry' call matches my Manual Implementation (which takes blob).

            const blob = Array.from(new TextEncoder().encode(jsonStr));

            if (currentEntry.id) {
                // My custom Update Entry takes blob.
                await invoke("update_entry", { id: currentEntry.id, uuid: currentEntry.uuid, blob, nonce: [] });
            } else {
                // Save Entry takes Payload struct.
                await invoke("save_entry", {
                    payload: {
                        title: currentEntry.uuid,
                        username: currentEntry.username || "MyUser",
                        password: jsonStr, // Store the huge JSON in password field?
                        // The user code packs everything into one JSON.
                        // So 'password' field in DB will hold the JSON.
                        notes: "",
                        totp_secret: null
                    }
                });
            }

            await refreshVault();
            setView("home");
        } catch (e) {
            alert("Save Failed: " + e);
        }
    }

    // --- STYLES ---
    const inputStyle = { width: "100%", padding: "12px", background: "#333", border: "none", color: "white", borderRadius: "6px", marginBottom: "15px", boxSizing: "border-box" as const };
    const sidebarBtnStyle = (active: boolean) => ({
        background: active ? "#8A2BE2" : "transparent", padding: "10px", borderRadius: "10px", border: "none", fontSize: "24px", cursor: "pointer", marginBottom: "10px"
    });

    return (
        <div style={{ display: "flex", height: "100vh", background: "#1a1a1a", color: "white", fontFamily: "sans-serif" }}>
            {/* Sidebar */}
            <div style={{ width: "90px", background: "#111", padding: "20px 0", display: "flex", flexDirection: "column", alignItems: "center", borderRight: "1px solid #333" }}>
                <button onClick={() => setView("home")} style={{ ...sidebarBtnStyle(false), marginBottom: "30px" }}>⬅️</button>
                <button onClick={() => setView("add")} style={sidebarBtnStyle(view === "add")}>➕</button>
                <button onClick={() => setView("home")} style={sidebarBtnStyle(view === "home")}>🏠</button>
                <div style={{ flexGrow: 1 }}></div>
                <button onClick={() => setView("sync")} style={sidebarBtnStyle(view === "sync")}>🔄</button>
            </div>

            {/* Content */}
            <div style={{ flexGrow: 1, padding: "40px", overflowY: "auto" }}>
                {view === "home" && (
                    <>
                        <h1>My Vault</h1>
                        <input placeholder="Search..." style={inputStyle} />
                        {entries.map(e => (
                            <div key={e.id} onClick={() => { setCurrentEntry(e); setView("detail"); }} style={{ padding: "15px", background: "#252525", marginBottom: "10px", borderRadius: "8px", cursor: "pointer", border: "1px solid #333" }}>
                                <strong>{e.uuid}</strong>
                            </div>
                        ))}
                    </>
                )}

                {(view === "add" || view === "detail") && (
                    <div style={{ maxWidth: "500px" }}>
                        <h2>{view === "add" ? "Add Entry" : "Edit Entry"}</h2>
                        <input placeholder="Site Name" value={currentEntry.uuid} onChange={e => setCurrentEntry({ ...currentEntry, uuid: e.target.value })} style={inputStyle} />
                        <input placeholder="Username" value={currentEntry.username || ""} onChange={e => setCurrentEntry({ ...currentEntry, username: e.target.value })} style={inputStyle} />
                        <input placeholder="Password" value={currentEntry.password || ""} onChange={e => setCurrentEntry({ ...currentEntry, password: e.target.value })} style={inputStyle} />

                        <div style={{ background: "#222", padding: "15px", borderRadius: "8px", marginBottom: "15px" }}>
                            <label style={{ color: "#888", fontSize: "12px" }}>TOTP Secret (Base32)</label>
                            <input placeholder="JBSWY..." value={currentEntry.totpSecret || ""} onChange={e => setCurrentEntry({ ...currentEntry, totpSecret: e.target.value })} style={{ ...inputStyle, marginBottom: 5 }} />
                            {view === "detail" && currentEntry.totpSecret && (
                                <div style={{ fontSize: "24px", color: "#007AFF", fontFamily: "monospace", marginTop: "10px" }}>
                                    {totpCode} <span style={{ fontSize: "14px", color: "#555" }}>({timeLeft}s)</span>
                                </div>
                            )}
                        </div>

                        <textarea placeholder="Notes" rows={4} value={currentEntry.notes || ""} onChange={e => setCurrentEntry({ ...currentEntry, notes: e.target.value })} style={inputStyle} />
                        <button onClick={handleSave} style={{ width: "100%", padding: "15px", background: "#007AFF", color: "white", border: "none", borderRadius: "8px", fontWeight: "bold", fontSize: "16px", cursor: "pointer" }}>Save</button>
                    </div>
                )}
            </div>
        </div>
    );
}

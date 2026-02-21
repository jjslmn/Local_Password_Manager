import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VaultEntry, Profile, DashboardProps, RawVaultEntry, PairedDevice, SyncHistoryEntry, SyncProgress } from "../types";

export default function Dashboard({ onLogout, sessionToken }: DashboardProps) {
    const [view, setView] = useState<"home" | "add" | "detail" | "sync" | "profiles">("home");
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<VaultEntry>({ uuid: "" });
    const [totpCode, setTotpCode] = useState("------");
    const [timeLeft, setTimeLeft] = useState(30);
    const [highlightedUuid, setHighlightedUuid] = useState<string | null>(null);
    const [showTotpSecret, setShowTotpSecret] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTargetEntry, setDeleteTargetEntry] = useState<VaultEntry | null>(null);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
    const [showProfileDropdown, setShowProfileDropdown] = useState(false);
    const [newProfileName, setNewProfileName] = useState("");
    const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
    const [editingProfileName, setEditingProfileName] = useState("");
    const [saveToProfileId, setSaveToProfileId] = useState<number | null>(null);

    // Sync state
    const [syncState, setSyncState] = useState<SyncProgress["state"]>("idle");
    const [syncProgress, _setSyncProgress] = useState<SyncProgress>({ state: "idle", chunks_transferred: 0, total_chunks: 0, message: "" });
    const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
    const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);
    const [syncTab, setSyncTab] = useState<"sync" | "devices" | "history">("sync");

    const refreshVault = useCallback(async () => {
        try {
            const rawData = await invoke<RawVaultEntry[]>("get_all_vault_entries", { token: sessionToken });
            const parsed = rawData.map((e) => {
                try {
                    const jsonString = String.fromCharCode(...e.data_blob);
                    const data = JSON.parse(jsonString);
                    return { id: e.id, uuid: e.uuid, entryUuid: e.entry_uuid, ...data };
                } catch {
                    return { id: e.id, uuid: e.uuid, entryUuid: e.entry_uuid };
                }
            });
            setEntries(parsed);
        } catch (e) {
            // Session expired — force logout
            if (String(e).includes("Session expired")) {
                onLogout();
            }
        }
    }, [sessionToken, onLogout]);

    const loadProfiles = useCallback(async () => {
        try {
            const profileList = await invoke<Profile[]>("get_all_profiles", { token: sessionToken });
            setProfiles(profileList);
            const activeId = await invoke<number>("get_active_profile", { token: sessionToken });
            const active = profileList.find(p => p.id === activeId) || profileList[0];
            setActiveProfile(active);
            if (active) {
                await invoke("set_active_profile", { id: active.id, token: sessionToken });
                refreshVault();
            }
        } catch {
            // Failed to load profiles
        }
    }, [sessionToken, refreshVault]);

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    // Clear highlight after animation
    useEffect(() => {
        if (highlightedUuid) {
            const timer = setTimeout(() => setHighlightedUuid(null), 1500);
            return () => clearTimeout(timer);
        }
    }, [highlightedUuid]);

    // TOTP Timer Logic
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined;
        if (view === "detail" && currentEntry.totpSecret) {
            const fetchCode = () => {
                invoke<string>("get_totp_token", { secret: currentEntry.totpSecret, token: sessionToken })
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
    }, [view, currentEntry.totpSecret, sessionToken]);

    async function handleProfileSwitch(profile: Profile) {
        try {
            await invoke("set_active_profile", { id: profile.id, token: sessionToken });
            setActiveProfile(profile);
            setShowProfileDropdown(false);
            await refreshVault();
        } catch (e) {
            alert("Failed to switch profile: " + e);
        }
    }

    async function handleCreateProfile() {
        if (!newProfileName.trim()) {
            alert("Profile name is required.");
            return;
        }
        try {
            await invoke("create_profile", { name: newProfileName.trim(), token: sessionToken });
            setNewProfileName("");
            await loadProfiles();
        } catch (e) {
            alert("Failed to create profile: " + e);
        }
    }

    async function handleRenameProfile(id: number) {
        if (!editingProfileName.trim()) {
            alert("Profile name is required.");
            return;
        }
        try {
            await invoke("rename_profile", { id, name: editingProfileName.trim(), token: sessionToken });
            setEditingProfileId(null);
            setEditingProfileName("");
            await loadProfiles();
        } catch (e) {
            alert("Failed to rename profile: " + e);
        }
    }

    async function handleDeleteProfile(profile: Profile) {
        if (profile.entryCount > 0) {
            alert("Cannot delete profile with entries. Move or delete entries first.");
            return;
        }
        if (profiles.length <= 1) {
            alert("Cannot delete the last profile.");
            return;
        }
        if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await invoke("delete_profile", { id: profile.id, token: sessionToken });
            if (activeProfile?.id === profile.id) {
                const remaining = profiles.filter(p => p.id !== profile.id);
                if (remaining.length > 0) {
                    await handleProfileSwitch(remaining[0]);
                }
            }
            await loadProfiles();
        } catch (e) {
            alert("Failed to delete profile: " + e);
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
                    await invoke<string>("get_totp_token", { secret: currentEntry.totpSecret, token: sessionToken });
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
                await invoke("update_entry", { id: currentEntry.id, uuid: currentEntry.uuid, blob, token: sessionToken });
            } else {
                // Pass profileId if a specific profile was selected, otherwise use active profile
                const profile_id = saveToProfileId || activeProfile?.id || null;
                await invoke("save_entry", { uuid: currentEntry.uuid, blob, profile_id, token: sessionToken });
            }

            await refreshVault();
            await loadProfiles(); // Refresh profile entry counts
            setShowTotpSecret(false);

            if (isNewEntry) {
                setHighlightedUuid(savedUuid);
                setCurrentEntry({ uuid: "" });
                setSaveToProfileId(null); // Reset profile selection
                setView("home");
            }
        } catch (e) {
            alert("Save Failed: " + e);
        }
    }

    function handleDeleteClick(entry: VaultEntry) {
        setDeleteTargetEntry(entry);
        setShowDeleteModal(true);
    }

    async function handleDeleteConfirm() {
        if (!deleteTargetEntry?.id) return;
        try {
            await invoke("delete_entry", { id: deleteTargetEntry.id, token: sessionToken });
            await refreshVault();
            setShowDeleteModal(false);
            setDeleteTargetEntry(null);
            setCurrentEntry({ uuid: "" });
            setView("home");
        } catch (e) {
            alert("Delete Failed: " + e);
        }
    }

    // --- SYNC HELPERS ---
    async function loadPairedDevices() {
        try {
            const devices = await invoke<PairedDevice[]>("get_paired_devices", { token: sessionToken });
            setPairedDevices(devices);
        } catch {
            // Failed to load paired devices
        }
    }

    async function loadSyncHistory() {
        try {
            const history = await invoke<SyncHistoryEntry[]>("get_sync_history", { token: sessionToken });
            setSyncHistory(history);
        } catch {
            // Failed to load sync history
        }
    }

    async function handleForgetDevice(deviceId: string) {
        if (!confirm("Unpair this device? You'll need to pair again to sync.")) return;
        try {
            await invoke("forget_device", { device_id: deviceId, token: sessionToken });
            await loadPairedDevices();
        } catch (e) {
            alert("Failed to unpair device: " + e);
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
                <button onClick={() => setView("profiles")} style={sidebarBtnStyle(view === "profiles")}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={view === "profiles" ? "#fff" : "#888"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
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
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                            <h1 style={{ margin: 0 }}>My Vault</h1>
                            {/* Profile Selector */}
                            <div style={{ position: "relative" }}>
                                <button
                                    onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                                    style={{
                                        background: "#252525",
                                        border: "1px solid #333",
                                        borderRadius: "6px",
                                        color: "white",
                                        padding: "8px 16px",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        fontSize: "14px"
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A2BE2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                        <circle cx="12" cy="7" r="4"/>
                                    </svg>
                                    {activeProfile?.name || "Select Profile"}
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M6 9l6 6 6-6"/>
                                    </svg>
                                </button>
                                {showProfileDropdown && (
                                    <div style={{
                                        position: "absolute",
                                        top: "100%",
                                        right: 0,
                                        marginTop: "4px",
                                        background: "#252525",
                                        border: "1px solid #333",
                                        borderRadius: "6px",
                                        minWidth: "180px",
                                        zIndex: 100,
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.3)"
                                    }}>
                                        {profiles.map(profile => (
                                            <button
                                                key={profile.id}
                                                onClick={() => handleProfileSwitch(profile)}
                                                style={{
                                                    display: "block",
                                                    width: "100%",
                                                    padding: "10px 16px",
                                                    background: profile.id === activeProfile?.id ? "rgba(138, 43, 226, 0.2)" : "transparent",
                                                    border: "none",
                                                    color: "white",
                                                    textAlign: "left",
                                                    cursor: "pointer",
                                                    fontSize: "14px"
                                                }}
                                            >
                                                {profile.name}
                                                <span style={{ color: "#555", marginLeft: "8px", fontSize: "12px" }}>
                                                    ({profile.entryCount})
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
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
                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Save to Profile</label>
                                    <select
                                        value={saveToProfileId || activeProfile?.id || ""}
                                        onChange={e => setSaveToProfileId(Number(e.target.value))}
                                        style={{
                                            width: "100%",
                                            padding: "12px",
                                            backgroundColor: "#333",
                                            border: "1px solid #444",
                                            color: "#fff",
                                            borderRadius: "6px",
                                            marginBottom: "15px",
                                            boxSizing: "border-box" as const,
                                            cursor: "pointer",
                                            fontSize: "14px",
                                            appearance: "none",
                                            WebkitAppearance: "none",
                                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                            backgroundRepeat: "no-repeat",
                                            backgroundPosition: "right 12px center"
                                        }}
                                    >
                                        {profiles.map(profile => (
                                            <option key={profile.id} value={profile.id} style={{ backgroundColor: "#333", color: "#fff" }}>
                                                {profile.name} ({profile.entryCount} entries)
                                            </option>
                                        ))}
                                    </select>
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

                        {view === "detail" && currentEntry.id && (
                            <button
                                type="button"
                                onClick={() => handleDeleteClick(currentEntry)}
                                style={{ width: "100%", padding: "15px", background: "transparent", color: "#ff4444", border: "1px solid #ff4444", borderRadius: "8px", fontWeight: "bold", fontSize: "16px", cursor: "pointer", marginTop: "15px" }}
                            >
                                Delete Entry
                            </button>
                        )}
                    </form>
                )}

                {view === "sync" && (
                    <div style={{ maxWidth: "550px" }}>
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

                        {/* Tab Bar */}
                        <div style={{ display: "flex", gap: "0", marginBottom: "24px", borderBottom: "1px solid #333" }}>
                            {(["sync", "devices", "history"] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => {
                                        setSyncTab(tab);
                                        if (tab === "devices") loadPairedDevices();
                                        if (tab === "history") loadSyncHistory();
                                    }}
                                    style={{
                                        background: "transparent",
                                        border: "none",
                                        borderBottom: syncTab === tab ? "2px solid #8A2BE2" : "2px solid transparent",
                                        color: syncTab === tab ? "#fff" : "#888",
                                        padding: "10px 20px",
                                        cursor: "pointer",
                                        fontSize: "14px",
                                        textTransform: "capitalize",
                                    }}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {/* Sync Tab */}
                        {syncTab === "sync" && (
                            <div>
                                {syncState === "idle" && (
                                    <div>
                                        <p style={{ color: "#888", marginBottom: "24px" }}>
                                            Sync your vault with an iPhone over Bluetooth Low Energy. Both devices must use the same master password.
                                        </p>
                                        <div style={{ display: "flex", gap: "12px" }}>
                                            <button
                                                onClick={() => setSyncState("advertising")}
                                                style={{
                                                    flex: 1,
                                                    padding: "16px",
                                                    background: "#8A2BE2",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "8px",
                                                    cursor: "pointer",
                                                    fontSize: "15px",
                                                    fontWeight: "bold",
                                                }}
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: "8px" }}>
                                                    <path d="M12 5l7 7-7 7M5 12h14"/>
                                                </svg>
                                                Send to iPhone
                                            </button>
                                            <button
                                                onClick={() => setSyncState("advertising")}
                                                style={{
                                                    flex: 1,
                                                    padding: "16px",
                                                    background: "#252525",
                                                    color: "white",
                                                    border: "1px solid #444",
                                                    borderRadius: "8px",
                                                    cursor: "pointer",
                                                    fontSize: "15px",
                                                    fontWeight: "bold",
                                                }}
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle", marginRight: "8px" }}>
                                                    <path d="M19 12H5M12 5l-7 7 7 7"/>
                                                </svg>
                                                Receive from iPhone
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {syncState === "advertising" && (
                                    <div style={{ textAlign: "center", padding: "30px 0" }}>
                                        <div style={{
                                            width: "64px",
                                            height: "64px",
                                            margin: "0 auto 20px",
                                            border: "3px solid #8A2BE2",
                                            borderRadius: "50%",
                                            borderTopColor: "transparent",
                                            animation: "spin 1s linear infinite",
                                        }} />
                                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                                        <p style={{ fontSize: "18px", marginBottom: "8px" }}>Waiting for iPhone...</p>
                                        <p style={{ color: "#888", fontSize: "14px" }}>Open VibeVault on your iPhone and tap "Sync with Desktop"</p>
                                        <button
                                            onClick={() => setSyncState("idle")}
                                            style={{
                                                marginTop: "20px",
                                                padding: "10px 24px",
                                                background: "#333",
                                                color: "#888",
                                                border: "none",
                                                borderRadius: "6px",
                                                cursor: "pointer",
                                                fontSize: "14px",
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}

                                {syncState === "pairing" && (
                                    <div style={{ textAlign: "center", padding: "30px 0" }}>
                                        <p style={{ color: "#888", fontSize: "14px", marginBottom: "16px" }}>Enter this code on your iPhone</p>
                                        <div style={{
                                            fontFamily: "monospace",
                                            fontSize: "48px",
                                            letterSpacing: "12px",
                                            color: "#8A2BE2",
                                            marginBottom: "24px",
                                            fontWeight: "bold",
                                        }}>
                                            {syncProgress.message || "------"}
                                        </div>
                                        <p style={{ color: "#555", fontSize: "12px" }}>Code expires in 60 seconds</p>
                                        <button
                                            onClick={() => setSyncState("idle")}
                                            style={{
                                                marginTop: "20px",
                                                padding: "10px 24px",
                                                background: "#333",
                                                color: "#888",
                                                border: "none",
                                                borderRadius: "6px",
                                                cursor: "pointer",
                                                fontSize: "14px",
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}

                                {syncState === "transferring" && (
                                    <div style={{ padding: "30px 0" }}>
                                        <p style={{ fontSize: "16px", marginBottom: "16px" }}>Syncing...</p>
                                        <div style={{
                                            height: "8px",
                                            background: "#333",
                                            borderRadius: "4px",
                                            overflow: "hidden",
                                            marginBottom: "12px",
                                        }}>
                                            <div style={{
                                                height: "100%",
                                                background: "#8A2BE2",
                                                borderRadius: "4px",
                                                width: syncProgress.total_chunks > 0
                                                    ? `${(syncProgress.chunks_transferred / syncProgress.total_chunks) * 100}%`
                                                    : "0%",
                                                transition: "width 0.3s ease",
                                            }} />
                                        </div>
                                        <p style={{ color: "#888", fontSize: "13px" }}>
                                            {syncProgress.chunks_transferred} / {syncProgress.total_chunks} chunks
                                        </p>
                                    </div>
                                )}

                                {syncState === "complete" && (
                                    <div style={{ textAlign: "center", padding: "30px 0" }}>
                                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "16px" }}>
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                            <polyline points="22 4 12 14.01 9 11.01"/>
                                        </svg>
                                        <p style={{ fontSize: "18px", marginBottom: "8px" }}>Sync Complete</p>
                                        <p style={{ color: "#888", fontSize: "14px" }}>{syncProgress.message}</p>
                                        <button
                                            onClick={() => { setSyncState("idle"); refreshVault(); }}
                                            style={{
                                                marginTop: "20px",
                                                padding: "12px 32px",
                                                background: "#8A2BE2",
                                                color: "white",
                                                border: "none",
                                                borderRadius: "6px",
                                                cursor: "pointer",
                                                fontSize: "14px",
                                                fontWeight: "bold",
                                            }}
                                        >
                                            Done
                                        </button>
                                    </div>
                                )}

                                {syncState === "error" && (
                                    <div style={{ textAlign: "center", padding: "30px 0" }}>
                                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "16px" }}>
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="15" y1="9" x2="9" y2="15"/>
                                            <line x1="9" y1="9" x2="15" y2="15"/>
                                        </svg>
                                        <p style={{ fontSize: "18px", marginBottom: "8px" }}>Sync Failed</p>
                                        <p style={{ color: "#888", fontSize: "14px" }}>{syncProgress.message}</p>
                                        <button
                                            onClick={() => setSyncState("idle")}
                                            style={{
                                                marginTop: "20px",
                                                padding: "12px 32px",
                                                background: "#333",
                                                color: "white",
                                                border: "none",
                                                borderRadius: "6px",
                                                cursor: "pointer",
                                                fontSize: "14px",
                                            }}
                                        >
                                            Try Again
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Devices Tab */}
                        {syncTab === "devices" && (
                            <div>
                                {pairedDevices.length === 0 ? (
                                    <p style={{ color: "#888" }}>No paired devices. Start a sync to pair with your iPhone.</p>
                                ) : (
                                    pairedDevices.map(device => (
                                        <div
                                            key={device.id}
                                            style={{
                                                padding: "15px",
                                                background: "#252525",
                                                marginBottom: "10px",
                                                borderRadius: "8px",
                                                border: "1px solid #333",
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                            }}
                                        >
                                            <div>
                                                <strong>{device.device_name}</strong>
                                                <div style={{ color: "#555", fontSize: "12px", marginTop: "4px" }}>
                                                    {device.last_sync_at
                                                        ? `Last synced: ${new Date(device.last_sync_at).toLocaleString()}`
                                                        : "Never synced"}
                                                </div>
                                                <div style={{ color: "#555", fontSize: "11px", marginTop: "2px" }}>
                                                    Paired: {new Date(device.paired_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleForgetDevice(device.device_id)}
                                                style={{
                                                    background: "none",
                                                    border: "1px solid #ff4444",
                                                    color: "#ff4444",
                                                    padding: "6px 12px",
                                                    borderRadius: "6px",
                                                    cursor: "pointer",
                                                    fontSize: "12px",
                                                }}
                                            >
                                                Unpair
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {/* History Tab */}
                        {syncTab === "history" && (
                            <div>
                                {syncHistory.length === 0 ? (
                                    <p style={{ color: "#888" }}>No sync history yet.</p>
                                ) : (
                                    syncHistory.map(entry => (
                                        <div
                                            key={entry.id}
                                            style={{
                                                padding: "12px 15px",
                                                background: "#252525",
                                                marginBottom: "8px",
                                                borderRadius: "8px",
                                                border: "1px solid #333",
                                                fontSize: "13px",
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <span>
                                                    <span style={{
                                                        display: "inline-block",
                                                        width: "8px",
                                                        height: "8px",
                                                        borderRadius: "50%",
                                                        background: entry.status === "success" ? "#4CAF50" : entry.status === "partial" ? "#FFC107" : "#ff4444",
                                                        marginRight: "8px",
                                                    }} />
                                                    {entry.direction === "push" ? "Sent" : "Received"}
                                                </span>
                                                <span style={{ color: "#555", fontSize: "12px" }}>
                                                    {entry.completed_at ? new Date(entry.completed_at).toLocaleString() : "In progress"}
                                                </span>
                                            </div>
                                            <div style={{ color: "#888", fontSize: "12px", marginTop: "4px" }}>
                                                {entry.entries_sent > 0 && `${entry.entries_sent} sent`}
                                                {entry.entries_sent > 0 && entry.entries_received > 0 && " / "}
                                                {entry.entries_received > 0 && `${entry.entries_received} received`}
                                                {entry.error_message && (
                                                    <span style={{ color: "#ff4444", marginLeft: "8px" }}>{entry.error_message}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                )}

                {view === "profiles" && (
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
                        <h2 style={{ marginTop: "0" }}>Manage Profiles</h2>

                        {/* Create New Profile */}
                        <div style={{ marginBottom: "30px" }}>
                            <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Create New Profile</label>
                            <div style={{ display: "flex", gap: "10px" }}>
                                <input
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    placeholder="Profile name..."
                                    style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                                    onKeyDown={e => e.key === "Enter" && handleCreateProfile()}
                                />
                                <button
                                    onClick={handleCreateProfile}
                                    style={{
                                        padding: "12px 20px",
                                        background: "#8A2BE2",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "6px",
                                        cursor: "pointer",
                                        fontWeight: "bold"
                                    }}
                                >
                                    Create
                                </button>
                            </div>
                        </div>

                        {/* Profile List */}
                        <label style={{ color: "#888", fontSize: "12px", display: "block", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Your Profiles</label>
                        {profiles.map(profile => (
                            <div
                                key={profile.id}
                                style={{
                                    padding: "15px",
                                    background: profile.id === activeProfile?.id ? "rgba(138, 43, 226, 0.15)" : "#252525",
                                    marginBottom: "10px",
                                    borderRadius: "8px",
                                    border: profile.id === activeProfile?.id ? "1px solid rgba(138, 43, 226, 0.4)" : "1px solid #333"
                                }}
                            >
                                {editingProfileId === profile.id ? (
                                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                        <input
                                            value={editingProfileName}
                                            onChange={e => setEditingProfileName(e.target.value)}
                                            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                                            autoFocus
                                            onKeyDown={e => {
                                                if (e.key === "Enter") handleRenameProfile(profile.id);
                                                if (e.key === "Escape") { setEditingProfileId(null); setEditingProfileName(""); }
                                            }}
                                        />
                                        <button
                                            onClick={() => handleRenameProfile(profile.id)}
                                            style={{ background: "#8A2BE2", border: "none", color: "white", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={() => { setEditingProfileId(null); setEditingProfileName(""); }}
                                            style={{ background: "#333", border: "none", color: "white", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div>
                                            <strong>{profile.name}</strong>
                                            {profile.id === activeProfile?.id && (
                                                <span style={{ marginLeft: "10px", fontSize: "12px", color: "#8A2BE2" }}>Active</span>
                                            )}
                                            <div style={{ color: "#555", fontSize: "12px", marginTop: "4px" }}>
                                                {profile.entryCount} {profile.entryCount === 1 ? "entry" : "entries"}
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", gap: "8px" }}>
                                            <button
                                                onClick={() => { setEditingProfileId(profile.id); setEditingProfileName(profile.name); }}
                                                style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: "4px" }}
                                                title="Rename"
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                                </svg>
                                            </button>
                                            {profiles.length > 1 && profile.entryCount === 0 && (
                                                <button
                                                    onClick={() => handleDeleteProfile(profile)}
                                                    style={{ background: "none", border: "none", color: "#ff4444", cursor: "pointer", padding: "4px" }}
                                                    title="Delete"
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="3 6 5 6 21 6"/>
                                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(0, 0, 0, 0.7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000
                }}>
                    <div style={{
                        background: "#252525",
                        borderRadius: "12px",
                        padding: "30px",
                        maxWidth: "400px",
                        width: "90%",
                        border: "1px solid #333"
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: "15px" }}>Delete Entry?</h3>
                        <p style={{ color: "#888", marginBottom: "25px" }}>
                            Are you sure you want to delete <strong style={{ color: "#fff" }}>{deleteTargetEntry?.uuid}</strong>? This action cannot be undone.
                        </p>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button
                                onClick={() => { setShowDeleteModal(false); setDeleteTargetEntry(null); }}
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    background: "#333",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    fontSize: "14px"
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteConfirm}
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    background: "#ff4444",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    fontWeight: "bold"
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

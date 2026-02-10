import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VaultEntry, Profile, DashboardProps, RawVaultEntry } from "../types";

export default function Dashboard({ onLogout }: DashboardProps) {
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

    useEffect(() => {
        loadProfiles();
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
        let interval: ReturnType<typeof setInterval> | undefined;
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

    async function loadProfiles() {
        try {
            const profileList = await invoke<Profile[]>("get_all_profiles");
            setProfiles(profileList);
            const activeId = await invoke<number>("get_active_profile");
            const active = profileList.find(p => p.id === activeId) || profileList[0];
            setActiveProfile(active);
            if (active) {
                await invoke("set_active_profile", { id: active.id });
                refreshVault();
            }
        } catch {
            // Failed to load profiles
        }
    }

    async function handleProfileSwitch(profile: Profile) {
        try {
            await invoke("set_active_profile", { id: profile.id });
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
            await invoke("create_profile", { name: newProfileName.trim() });
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
            await invoke("rename_profile", { id, name: editingProfileName.trim() });
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
            await invoke("delete_profile", { id: profile.id });
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

    async function refreshVault() {
        try {
            const rawData = await invoke<RawVaultEntry[]>("get_all_vault_entries");
            const parsed = rawData.map((e) => {
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
                // Pass profileId if a specific profile was selected, otherwise use active profile
                const profile_id = saveToProfileId || activeProfile?.id || null;
                await invoke("save_entry", { uuid: currentEntry.uuid, blob, nonce: [], profile_id });
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
            await invoke("delete_entry", { id: deleteTargetEntry.id });
            await refreshVault();
            setShowDeleteModal(false);
            setDeleteTargetEntry(null);
            setCurrentEntry({ uuid: "" });
            setView("home");
        } catch (e) {
            alert("Delete Failed: " + e);
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

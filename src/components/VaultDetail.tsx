import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { VaultEntry, VaultEntryPayload } from '../types';

interface Props {
    entry: VaultEntry;
}

interface TotpResponse {
    code: string;
    ttl: number;
}

export default function VaultDetail({ entry }: Props) {
    const [showPassword, setShowPassword] = useState(false);
    const [token, setToken] = useState<TotpResponse>({ code: '--- ---', ttl: 0 });

    // Edit State
    const [username, setUsername] = useState(entry.username);
    const [password, setPassword] = useState(entry.password || '');
    const [notes, setNotes] = useState(entry.notes || '');
    const [newTotpSecret, setNewTotpSecret] = useState('');
    const [showTotpSetup, setShowTotpSetup] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        // Reset state when entry changes
        setUsername(entry.username);
        setPassword(entry.password || '');
        setNotes(entry.notes || '');
        setNewTotpSecret('');
        setShowTotpSetup(false);
        setToken({ code: '--- ---', ttl: 0 });
    }, [entry]);

    useEffect(() => {
        if (!entry.has_totp) return;

        const fetchTotp = async () => {
            // Only fetch if we haven't just cleared it locally (e.g. during some edit flow? No, should be fine)
            try {
                const res = await invoke<TotpResponse>('get_totp_token', { uuid: entry.uuid });
                setToken(res);
            } catch (err) {
                console.error("TOTP Fetch Failed:", err);
                setToken({ code: "ERROR", ttl: 0 });
            }
        };

        fetchTotp();
        const interval = setInterval(fetchTotp, 1000);
        return () => clearInterval(interval);
    }, [entry.uuid, entry.has_totp]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const payload: VaultEntryPayload = {
                title: entry.title, // Title not editable per design request currently
                username,
                password,
                notes,
                totp_secret: newTotpSecret.length > 0 ? newTotpSecret : undefined
            };

            await invoke('update_entry', { uuid: entry.uuid, payload });
            alert("Changes saved! You may need to reload the list to see updates.");
            // Note: In a real app we'd trigger a reload up the chain
            if (newTotpSecret) {
                // Determine if we need to reload page or just local state. 
                // For now user alert is sufficient.
            }
        } catch (err) {
            alert("Failed to update: " + err);
        } finally {
            setIsSaving(false);
        }
    };

    const LabelStyle = {
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        fontWeight: 600,
        marginBottom: '6px',
        display: 'block',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px'
    };

    const FieldStyle = {
        background: 'var(--bg-color)',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
        padding: '12px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    };

    const InputResetStyle = {
        background: 'transparent',
        border: 'none',
        color: 'white',
        fontSize: '1rem',
        width: '100%',
        fontFamily: 'inherit',
        outline: 'none'
    };

    const IconButton = (label: string, onClick: () => void) => (
        <button
            onClick={onClick}
            style={{
                color: 'var(--accent-color)',
                fontWeight: 'bold',
                fontSize: '0.9rem',
                padding: '4px 8px',
                whiteSpace: 'nowrap'
            }}
        >
            {label}
        </button>
    );

    return (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            {/* Header: Title Only */}
            <div style={{ marginBottom: '30px', textAlign: 'center' }}>
                <h1 style={{ margin: '0 0 5px', fontSize: '2rem' }}>{entry.title}</h1>
            </div>

            <div style={{ background: 'var(--card-bg)', borderRadius: '12px', padding: '25px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>

                {/* Username */}
                <label style={LabelStyle}>Username / Email</label>
                <div style={FieldStyle}>
                    <input
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        style={InputResetStyle}
                    />
                    {IconButton("Copy", () => navigator.clipboard.writeText(username))}
                </div>

                {/* Password */}
                <label style={LabelStyle}>Password</label>
                <div style={FieldStyle}>
                    <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        style={{ ...InputResetStyle, fontFamily: 'monospace' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {IconButton(showPassword ? "Hide" : "Show", () => setShowPassword(!showPassword))}
                        {IconButton("Copy", () => navigator.clipboard.writeText(password))}
                    </div>
                </div>

                {/* TOTP */}
                <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <label style={{ ...LabelStyle, marginBottom: 0 }}>Two-Factor Code</label>
                        {entry.has_totp && <div style={{ fontSize: '0.9rem', color: token.ttl < 5 ? '#ff4444' : 'var(--text-muted)' }}>Expires in {token.ttl}s</div>}
                    </div>

                    {entry.has_totp ? (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{
                                    fontSize: '2.5rem',
                                    fontFamily: 'monospace',
                                    fontWeight: 'bold',
                                    color: 'var(--text-color)',
                                    letterSpacing: '4px'
                                }}>
                                    {token.code.slice(0, 3)} <span style={{ opacity: 0.5 }}> </span> {token.code.slice(3)}
                                </div>
                                {IconButton("Copy", () => navigator.clipboard.writeText(token.code))}
                            </div>
                            <progress value={token.ttl} max={30} style={{ width: '100%', height: '4px', marginTop: '15px', borderRadius: '2px' }}></progress>
                        </>
                    ) : (
                        <div>
                            {!showTotpSetup ? (
                                <button
                                    onClick={() => setShowTotpSetup(true)}
                                    style={{
                                        width: '100%', padding: '12px', background: '#333',
                                        color: 'white', borderRadius: '6px', fontWeight: 'bold'
                                    }}
                                >
                                    Setup 2FA
                                </button>
                            ) : (
                                <div style={{ background: '#222', padding: '15px', borderRadius: '8px' }}>
                                    <p style={{ margin: '0 0 10px', fontSize: '0.9rem', color: '#ccc' }}>Paste your Secret Key (Base32) below:</p>
                                    <input
                                        value={newTotpSecret}
                                        onChange={e => setNewTotpSecret(e.target.value)}
                                        placeholder="JBSWY3DPEHPK3PXP..."
                                        style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #444', background: '#111', color: 'white', marginBottom: '10px' }}
                                    />
                                    <div style={{ fontSize: '0.8rem', color: '#888' }}>Click "Save Changes" below to apply.</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Notes */}
            <div style={{ marginTop: '20px', padding: '20px', background: 'var(--card-bg)', borderRadius: '12px' }}>
                <label style={LabelStyle}>Notes</label>
                <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    style={{ ...InputResetStyle, minHeight: '100px', lineHeight: '1.6', resize: 'vertical' }}
                    placeholder="Add secure notes..."
                ></textarea>
            </div>

            {/* Save Button */}
            <button
                onClick={handleSave}
                disabled={isSaving}
                style={{
                    width: '100%',
                    marginTop: '30px',
                    padding: '15px',
                    backgroundColor: 'var(--accent-color)',
                    color: '#000',
                    fontWeight: 'bold',
                    fontSize: '1.1rem',
                    borderRadius: '8px',
                    opacity: isSaving ? 0.7 : 1
                }}
            >
                {isSaving ? "Saving..." : "Save Changes"}
            </button>
        </div>
    );
}

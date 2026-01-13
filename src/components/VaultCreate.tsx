import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { VaultEntryPayload } from '../types';

interface Props {
    onSave: () => void;
    onCancel: () => void;
}

export default function VaultCreate({ onSave, onCancel }: Props) {
    const [title, setTitle] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [totpSecret, setTotpSecret] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const payload: VaultEntryPayload = {
            title, username, password, notes,
            totp_secret: totpSecret.length > 0 ? totpSecret : undefined
        };
        try {
            await invoke('save_entry', { payload });
            onSave();
        } catch (err) {
            alert("Failed to save: " + err);
            setLoading(false);
        }
    };

    const InputStyle = {
        width: '100%',
        marginBottom: '10px',
        padding: '12px',
        backgroundColor: '#1E1E1E',
        border: '1px solid #333',
        color: '#FFF',
        borderRadius: '6px',
        fontSize: '1rem'
    };

    const ButtonStyle = (primary: boolean) => ({
        padding: '12px 24px',
        borderRadius: '6px',
        border: 'none',
        backgroundColor: primary ? '#BB86FC' : 'transparent',
        color: primary ? '#000' : '#888',
        fontWeight: 'bold',
        cursor: 'pointer',
        fontSize: '1rem',
        marginTop: '20px',
        marginRight: '10px'
    });

    return (
        <div style={{ maxWidth: '500px', margin: '40px auto' }}>
            <h2 style={{ marginBottom: '30px' }}>Add New Entry</h2>
            <form onSubmit={handleSave}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>Title</label>
                <input style={InputStyle} value={title} onChange={e => setTitle(e.target.value)} required autoFocus />

                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>Username</label>
                <input style={InputStyle} value={username} onChange={e => setUsername(e.target.value)} required />

                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>Password</label>
                <input style={InputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} required />

                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>TOTP Secret (Optional)</label>
                <input style={InputStyle} value={totpSecret} onChange={e => setTotpSecret(e.target.value)} placeholder="Base32 Key" />

                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>Notes</label>
                <textarea style={{ ...InputStyle, minHeight: '100px' }} value={notes} onChange={e => setNotes(e.target.value)}></textarea>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={onCancel} style={ButtonStyle(false)}>
                        Cancel
                    </button>
                    <button type="submit" disabled={loading} style={ButtonStyle(true)}>
                        {loading ? "Saving..." : "Save Entry"}
                    </button>
                </div>
            </form>
        </div>
    );
}

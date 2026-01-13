import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { VaultEntry, VaultEntryResponse } from '../types';
import VaultItem from './VaultItem';

interface Props {
    onSelect: (entry: VaultEntry) => void;
}

export default function VaultList({ onSelect }: Props) {
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchEntries = async () => {
        setLoading(true);
        try {
            const responses = await invoke<VaultEntryResponse[]>('get_all_entries');
            const mapped: VaultEntry[] = responses.map(r => ({
                id: r.id,
                uuid: r.uuid,
                title: r.payload.title,
                username: r.payload.username,
                has_totp: !!(r.payload.totp_secret && r.payload.totp_secret.length > 0),
                password: r.payload.password,
                notes: r.payload.notes
            }));
            setEntries(mapped);
        } catch (err) {
            console.error("Failed to load entries:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEntries();
    }, []);

    const filtered = entries.filter(e =>
        e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.username.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ marginBottom: '20px' }}>
                <h2 style={{ marginBottom: '15px' }}>My Vault</h2>
                <input
                    placeholder="Search vault..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '12px',
                        background: '#1E1E1E',
                        border: '1px solid #333',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '1rem',
                        outline: 'none'
                    }}
                />
            </div>

            {/* List */}
            {loading ? <p>Loading...</p> : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filtered.map(entry => (
                        <div key={entry.uuid} onClick={() => onSelect(entry)}>
                            <VaultItem entry={entry} />
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <p style={{ opacity: 0.5, textAlign: 'center', marginTop: '40px' }}>
                            {searchTerm ? "No matches found." : "No entries found. Press + to add."}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

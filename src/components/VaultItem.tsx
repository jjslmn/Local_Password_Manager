import { VaultEntry } from '../types';

interface Props {
    entry: VaultEntry;
}

export default function VaultItem({ entry }: Props) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 10px',
            borderBottom: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
        }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
            }}
        >
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#fff' }}>
                    {entry.title}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {entry.username}
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                {entry.has_totp && (
                    <div style={{
                        fontSize: '0.7em',
                        color: 'var(--accent-color)',
                        border: '1px solid var(--accent-color)',
                        padding: '2px 6px',
                        borderRadius: '4px'
                    }}>
                        TOTP
                    </div>
                )}
                <div style={{ color: '#666' }}>›</div>
            </div>
        </div>
    );
}

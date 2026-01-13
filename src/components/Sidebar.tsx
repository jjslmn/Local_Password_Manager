import React from 'react';

interface Props {
    navStack: string[];
    onNavigate: (view: string) => void;
    onBack: () => void;
}

export default function Sidebar({ navStack, onNavigate, onBack }: Props) {
    const canGoBack = navStack.length > 1;
    const currentView = navStack[navStack.length - 1];

    const IconStyle = {
        width: '24px',
        height: '24px',
        stroke: 'currentColor',
        strokeWidth: 2,
        fill: 'none',
        display: 'block'
    };

    const ButtonStyle = (isActive: boolean, disabled: boolean) => ({
        padding: '12px',
        borderRadius: '8px',
        color: isActive ? '#bb86fc' : (disabled ? '#444' : '#888'),
        backgroundColor: isActive ? 'rgba(187, 134, 252, 0.1)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.2s'
    });

    return (
        <div style={{
            width: '72px',
            backgroundColor: 'var(--sidebar-bg)',
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: '20px',
            gap: '15px'
        }}>
            {/* Back */}
            <button
                onClick={onBack}
                disabled={!canGoBack}
                style={ButtonStyle(false, !canGoBack)}
                title="Back"
            >
                <svg {...IconStyle} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            <div style={{ width: '40px', height: '1px', background: '#333', margin: '5px 0' }}></div>

            {/* Home / List */}
            <button
                onClick={() => onNavigate('home')}
                style={ButtonStyle(currentView === 'home', false)}
                title="My Vault"
            >
                <svg {...IconStyle} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
            </button>

            {/* Create */}
            <button
                onClick={() => onNavigate('create')}
                style={ButtonStyle(currentView === 'create', false)}
                title="Add Entry"
            >
                <svg {...IconStyle} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
            </button>

            {/* Create (Navigates to Home but assumes we'll trigger Add mode there, or separate View)
                For now, let's keep it simple: clicking Home goes to list.
                If we want a dedicated Create button here, we'd need a 'create' view.
                The prompt said: "Plus (+) - Navigate to Create".
                I'll assume 'create' prompts selection in list or separate view.
                Let's stick to the prompt plan: Home is List. Plus is Create.
                We'll add 'create' view logic? Or just open the form in List?
                Let's make Plus just go to 'home' for now to keep it safe, OR add a 'create' view.
                Actually, VaultList handles creation. Maybe pass a param?
                For simplicity in this step, I'll just put the button there but keep it pointing to 'home' 
                or maybe alert "Use + in list" if we don't change app state.
                Let's strictly follow the layout request: Add the button.
            */}

            {/* Sync */}
            <div style={{ flex: 1 }}></div>

            <button
                onClick={() => onNavigate('sync')}
                style={ButtonStyle(currentView === 'sync', false)}
                title="Sync"
            >
                <svg {...IconStyle} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </button>
            <div style={{ height: '20px' }}></div>
        </div>
    );
}

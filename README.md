# VibeVault

A secure, offline-first password manager built with Tauri 2.0. Store your credentials locally with strong encryption - your data never leaves your machine.

## Features

- **Local-first storage**: All data stored in SQLite on your device
- **Strong encryption**: Argon2id password hashing with AES-256-GCM encryption
- **TOTP support**: Built-in two-factor authentication code generator
- **Desktop native**: Runs as a native app on Windows and Ubuntu

## Download & Install

### Pre-built Releases

Download the latest release for your platform from the [Releases](https://github.com/yourusername/vibevault/releases) page:

| Platform | Download | Install Method |
|----------|----------|----------------|
| Windows 10/11 | `VibeVault_1.0.0_x64-setup.exe` | Run installer, follow prompts |
| Windows 10/11 | `VibeVault_1.0.0_x64_en-US.msi` | Run MSI, follow prompts |
| Ubuntu/Debian | `vibevault_1.0.0_amd64.deb` | `sudo dpkg -i vibevault_1.0.0_amd64.deb` |
| Ubuntu/Linux | `vibevault_1.0.0_amd64.AppImage` | `chmod +x *.AppImage && ./vibevault_1.0.0_amd64.AppImage` |

After installation, VibeVault will appear in your applications menu and can be pinned to your taskbar.

## Building from Source

### Prerequisites

#### All Platforms

- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://rustup.rs/) (latest stable)

#### Windows

- [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- WebView2 (included in Windows 10/11)

#### Ubuntu/Debian

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Build Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/jjslmn/vibevault.git
   cd vibevault
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build for production:
   ```bash
   npm run tauri build
   ```

### Build Outputs

| Platform | Output Location | Description |
|----------|-----------------|-------------|
| Windows | `src-tauri/target/release/bundle/nsis/` | NSIS installer (.exe) |
| Windows | `src-tauri/target/release/bundle/msi/` | MSI installer |
| Ubuntu | `src-tauri/target/release/bundle/deb/` | Debian package (.deb) |
| Linux | `src-tauri/target/release/bundle/appimage/` | AppImage (portable) |

## Development

```bash
# Start development server with hot reload
npm run tauri dev

# Build production release
npm run tauri build

# Run frontend only (without Tauri)
npm run dev

# Type check frontend
npm run build
```

## Security

VibeVault uses industry-standard cryptography:

- **Password Hashing**: Argon2id (memory-hard, resistant to GPU/ASIC attacks)
- **Data Encryption**: AES-256-GCM (authenticated encryption)
- **TOTP**: HMAC-SHA1 per RFC 6238

All vault data is stored locally in an SQLite database at:
- **Windows**: `%APPDATA%\com.vibevault.app\vibevault.db`
- **Linux**: `~/.local/share/com.vibevault.app/vibevault.db`

## Project Structure

```
vibevault/
├── src/                    # React frontend
│   ├── App.tsx            # Main app component
│   └── components/        # UI components
├── src-tauri/             # Rust backend
│   ├── src/main.rs        # Tauri commands & database
│   ├── tauri.conf.json    # Tauri configuration
│   └── Cargo.toml         # Rust dependencies
└── package.json           # Node.js dependencies
```

## License

MIT

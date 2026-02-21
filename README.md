# VibeVault

A secure, offline-first password manager for desktop and iOS. Store your credentials locally with strong encryption - your data never leaves your devices. Sync between platforms over encrypted BLE.

## Features

- **Local-first storage**: All data stored in SQLite on your device
- **Strong encryption**: Argon2id password hashing with AES-256-GCM encryption
- **TOTP support**: Built-in two-factor authentication code generator
- **Multi-platform**: Desktop (Windows, Ubuntu) via Tauri + iOS (SwiftUI)
- **BLE sync**: Encrypted Bluetooth sync between desktop and iPhone

## Download & Install

### Pre-built Releases

Download the latest release for your platform from the [Releases](https://github.com/jjslmn/Local_Password_Manager/releases) page:

| Platform | Download | Install Method |
|----------|----------|----------------|
| Windows 10/11 | `VibeVault_1.0.3_x64-setup.exe` | Run installer, follow prompts |
| Windows 10/11 | `VibeVault_1.0.3_x64_en-US.msi` | Run MSI, follow prompts |
| Ubuntu/Debian | `vibevault_1.0.3_amd64.deb` | `sudo dpkg -i vibevault_1.0.3_amd64.deb` |
| Ubuntu/Linux | `vibevault_1.0.3_amd64.AppImage` | `chmod +x *.AppImage && ./vibevault_1.0.3_amd64.AppImage` |

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

### Build Steps (Desktop)

1. Clone the repository:
   ```bash
   git clone https://github.com/jjslmn/Local_Password_Manager.git
   cd Local_Password_Manager/vibevault-desktop
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
| Windows | `vibevault-desktop/src-tauri/target/release/bundle/nsis/` | NSIS installer (.exe) |
| Windows | `vibevault-desktop/src-tauri/target/release/bundle/msi/` | MSI installer |
| Ubuntu | `vibevault-desktop/src-tauri/target/release/bundle/deb/` | Debian package (.deb) |
| Linux | `vibevault-desktop/src-tauri/target/release/bundle/appimage/` | AppImage (portable) |

## Development

```bash
cd vibevault-desktop

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
Password_Manager/                # git root (monorepo)
├── vibevault-desktop/           # Desktop app (Tauri 2.0)
│   ├── src/                     # React frontend
│   ├── src-tauri/               # Rust backend
│   └── package.json
└── vibevault-ios/               # iOS app (SwiftUI)
    ├── Package.swift
    └── VibeVault/
```

## Releases

Desktop releases are automated via GitHub Actions. To create a new release:

1. Update the version in `vibevault-desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, and `package.json`
2. Commit and push to `master`
3. Create and push a version tag:
   ```bash
   git tag v1.0.3
   git push origin v1.0.3
   ```
4. GitHub Actions will build for Ubuntu and Windows, then publish to the [Releases](https://github.com/jjslmn/Local_Password_Manager/releases) page

## License

MIT

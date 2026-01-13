# VibeVault

A secure, offline-first password manager built with Tauri 2.0. Store your credentials locally with strong encryption - your data never leaves your machine.

## Features

- **Local-first storage**: All data stored in SQLite on your device
- **Strong encryption**: Argon2id password hashing with AES-256-GCM encryption
- **TOTP support**: Built-in two-factor authentication code generator
- **Cross-platform**: Works on Windows, macOS, and Linux

## Prerequisites

### All Platforms

- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://rustup.rs/) (latest stable)

### Platform-Specific Requirements

#### Windows

- [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- WebView2 (included in Windows 10/11)

#### macOS

- Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```

#### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

#### Linux (Fedora)

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "C Development Tools and Libraries"
```

#### Linux (Arch)

```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg
```

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/jjslmn/vibevault.git
   cd vibevault
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run tauri dev
   ```

## Building for Production

Build an optimized release for your current platform:

```bash
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

### Build Outputs by Platform

| Platform | Output Location |
|----------|-----------------|
| Windows  | `src-tauri/target/release/bundle/msi/` and `nsis/` |
| macOS    | `src-tauri/target/release/bundle/macos/` and `dmg/` |
| Linux    | `src-tauri/target/release/bundle/deb/` and `appimage/` |

## Development Commands

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
- **macOS**: `~/Library/Application Support/com.vibevault.app/vibevault.db`
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

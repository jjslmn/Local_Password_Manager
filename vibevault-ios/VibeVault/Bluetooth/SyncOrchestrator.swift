import Foundation
import CryptoKit
import Combine

/// High-level sync flow orchestrator connecting BLE, crypto, and database
@MainActor
class SyncOrchestrator: ObservableObject {
    @Published var state: SyncState = .idle
    @Published var progress: String = ""
    @Published var entriesSynced: Int = 0

    let bleManager = BLECentralManager()
    private var cancellables = Set<AnyCancellable>()
    private var sessionKey: SymmetricKey?
    private var reassembler: BLEProtocol.ChunkReassembler?

    init() {
        // Observe BLE state changes
        bleManager.$state
            .receive(on: RunLoop.main)
            .sink { [weak self] bleState in
                self?.handleBLEStateChange(bleState)
            }
            .store(in: &cancellables)
    }

    // MARK: - Public API

    func startSync() {
        state = .scanning
        bleManager.startScanning()
    }

    func connectToDevice(_ device: DiscoveredDevice) {
        bleManager.connect(to: device)
    }

    func submitPairingCode(_ code: String) {
        guard let peerPublicKeyData = bleManager.syncProgress.peerPublicKey else {
            state = .error("No peer public key received")
            return
        }

        do {
            // Parse peer's public key
            let peerPublicKey = try P256.KeyAgreement.PublicKey(compactRepresentation: peerPublicKeyData)

            // Generate our keypair
            let privateKey = CryptoService.generateECDHKeyPair()
            let publicKeyData = privateKey.publicKey.compressedRepresentation

            // Compute HMAC(code, our_public_key) for verification
            let hmac = CryptoService.computePairingHMAC(code: code, publicKeyBytes: publicKeyData)

            // Send our public key + HMAC to desktop
            var pairingPayload = publicKeyData
            pairingPayload.append(hmac)
            bleManager.writePairingData(pairingPayload)

            // Derive session key
            sessionKey = try CryptoService.deriveSessionKey(
                privateKey: privateKey,
                peerPublicKey: peerPublicKey
            )

            state = .paired
        } catch {
            state = .error("Pairing failed: \(error.localizedDescription)")
        }
    }

    func startDataTransfer() {
        guard sessionKey != nil else {
            state = .error("Not paired")
            return
        }

        state = .transferring
        progress = "Starting transfer..."

        // Subscribe to notifications for receiving data
        bleManager.subscribeToDataTransfer()
        bleManager.subscribeToSyncControl()

        // Send START_SYNC command
        bleManager.writeSyncControl(0x01)
    }

    func cancel() {
        bleManager.disconnect()
        sessionKey = nil
        reassembler = nil
        state = .idle
    }

    // MARK: - Private

    private func handleBLEStateChange(_ bleState: BLEState) {
        switch bleState {
        case .ready:
            // Characteristics discovered — read mode and pairing data
            bleManager.readMode()
            bleManager.readPairingData()
            state = .pairing

        case .complete:
            state = .complete

        case .error(let msg):
            state = .error(msg)

        default:
            break
        }
    }

    enum SyncState: Equatable {
        case idle
        case scanning
        case pairing
        case paired
        case transferring
        case complete
        case error(String)
    }
}

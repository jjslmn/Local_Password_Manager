import SwiftUI

struct SyncView: View {
    @Environment(\.dismiss) var dismiss
    @StateObject private var orchestrator = SyncOrchestrator()
    @State private var pairingCode = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                switch orchestrator.state {
                case .idle:
                    idleView

                case .scanning:
                    scanningView

                case .pairing:
                    pairingView

                case .paired:
                    pairedView

                case .transferring:
                    transferringView

                case .complete:
                    completeView

                case .error(let message):
                    errorView(message)
                }
            }
            .padding()
            .navigationTitle("Sync with Desktop")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        orchestrator.cancel()
                        dismiss()
                    }
                }
            }
        }
    }

    // MARK: - State Views

    private var idleView: some View {
        VStack(spacing: 16) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 48))
                .foregroundColor(.purple)
                .padding(.bottom, 8)

            Text("Sync your vault with your desktop over Bluetooth.")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            Text("Make sure VibeVault is running on your desktop and has started a sync.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            Button {
                orchestrator.startSync()
            } label: {
                Label("Scan for Desktop", systemImage: "antenna.radiowaves.left.and.right")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.large)
            .padding(.top, 16)
        }
    }

    private var scanningView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
                .padding(.bottom, 8)

            Text("Scanning for VibeVault Desktop...")
                .foregroundColor(.secondary)

            if !orchestrator.bleManager.discoveredDevices.isEmpty {
                VStack(spacing: 8) {
                    ForEach(orchestrator.bleManager.discoveredDevices) { device in
                        Button {
                            orchestrator.connectToDevice(device)
                        } label: {
                            HStack {
                                Image(systemName: "desktopcomputer")
                                    .foregroundColor(.purple)
                                VStack(alignment: .leading) {
                                    Text(device.name)
                                        .fontWeight(.medium)
                                    Text("Signal: \(device.rssi) dBm")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(.secondary)
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(10)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Button("Cancel") {
                orchestrator.cancel()
            }
            .foregroundColor(.secondary)
            .padding(.top, 8)
        }
    }

    private var pairingView: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield")
                .font(.system(size: 48))
                .foregroundColor(.purple)
                .padding(.bottom, 8)

            Text("Enter the 6-digit code shown on your desktop")
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)

            TextField("000000", text: $pairingCode)
                .font(.system(size: 36, weight: .bold, design: .monospaced))
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .frame(maxWidth: 200)

            Button("Confirm") {
                orchestrator.submitPairingCode(pairingCode)
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .disabled(pairingCode.count != 6)

            Button("Cancel") {
                orchestrator.cancel()
            }
            .foregroundColor(.secondary)
        }
    }

    private var pairedView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 48))
                .foregroundColor(.green)
                .padding(.bottom, 8)

            Text("Paired successfully!")
                .font(.headline)

            Button {
                orchestrator.startDataTransfer()
            } label: {
                Label("Start Sync", systemImage: "arrow.triangle.2.circlepath")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.large)
        }
    }

    private var transferringView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
                .padding(.bottom, 8)

            Text("Syncing...")
                .font(.headline)

            Text(orchestrator.progress)
                .foregroundColor(.secondary)
                .font(.footnote)
        }
    }

    private var completeView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 64))
                .foregroundColor(.green)
                .padding(.bottom, 8)

            Text("Sync Complete!")
                .font(.headline)

            Text("\(orchestrator.entriesSynced) entries synced")
                .foregroundColor(.secondary)

            Button("Done") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.large)
            .padding(.top, 16)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "xmark.circle")
                .font(.system(size: 64))
                .foregroundColor(.red)
                .padding(.bottom, 8)

            Text("Sync Failed")
                .font(.headline)

            Text(message)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Try Again") {
                orchestrator.cancel()
                pairingCode = ""
            }
            .buttonStyle(.bordered)
            .padding(.top, 16)
        }
    }
}

import SwiftUI
import CryptoKit

struct AddEntryView: View {
    let profileId: Int64
    let onSave: () -> Void

    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var authService: AuthService

    @State private var siteName = ""
    @State private var username = ""
    @State private var password = ""
    @State private var totpSecret = ""
    @State private var notes = ""
    @State private var error = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Entry Details") {
                    TextField("Site Name", text: $siteName)
                    TextField("Username", text: $username)
                    SecureField("Password", text: $password)
                }

                Section("Optional") {
                    TextField("TOTP Secret", text: $totpSecret)
                        .textInputAutocapitalization(.characters)
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                if !error.isEmpty {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("Add Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { saveEntry() }
                        .disabled(siteName.isEmpty)
                }
            }
        }
    }

    private func saveEntry() {
        guard let key = authService.getEncryptionKey() else {
            error = "Session expired"
            return
        }

        let entryData = VaultEntryData(
            username: username.isEmpty ? nil : username,
            password: password.isEmpty ? nil : password,
            totpSecret: totpSecret.isEmpty ? nil : totpSecret,
            notes: notes.isEmpty ? nil : notes
        )

        do {
            let jsonData = try JSONEncoder().encode(entryData)
            let (ciphertext, nonce) = try CryptoService.encrypt(jsonData, key: key)
            let now = ISO8601DateFormatter().string(from: Date())

            var entry = VaultEntry(
                uuid: siteName,
                dataBlob: ciphertext,
                nonce: nonce,
                profileId: profileId,
                entryUuid: UUID().uuidString,
                createdAt: now,
                updatedAt: now,
                syncVersion: 1
            )
            try DatabaseService.shared.saveEntry(&entry)
            onSave()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

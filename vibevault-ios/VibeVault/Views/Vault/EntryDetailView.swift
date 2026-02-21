import SwiftUI

struct EntryDetailView: View {
    let entry: DisplayEntry
    let onDismiss: () -> Void

    @Environment(\.dismiss) var dismiss
    @EnvironmentObject var authService: AuthService

    @State private var siteName: String
    @State private var username: String
    @State private var password: String
    @State private var totpSecret: String
    @State private var notes: String
    @State private var showPassword = false
    @State private var showDeleteConfirm = false
    @State private var error = ""

    init(entry: DisplayEntry, onDismiss: @escaping () -> Void) {
        self.entry = entry
        self.onDismiss = onDismiss
        _siteName = State(initialValue: entry.siteName)
        _username = State(initialValue: entry.data.username ?? "")
        _password = State(initialValue: entry.data.password ?? "")
        _totpSecret = State(initialValue: entry.data.totpSecret ?? "")
        _notes = State(initialValue: entry.data.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Entry Details") {
                    TextField("Site Name", text: $siteName)

                    HStack {
                        TextField("Username", text: $username)
                        Button {
                            UIPasteboard.general.string = username
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .foregroundColor(.purple)
                        }
                    }

                    HStack {
                        if showPassword {
                            TextField("Password", text: $password)
                        } else {
                            SecureField("Password", text: $password)
                        }
                        Button {
                            showPassword.toggle()
                        } label: {
                            Image(systemName: showPassword ? "eye.slash" : "eye")
                                .foregroundColor(.secondary)
                        }
                        Button {
                            UIPasteboard.general.string = password
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .foregroundColor(.purple)
                        }
                    }
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

                Section {
                    Button("Delete Entry", role: .destructive) {
                        showDeleteConfirm = true
                    }
                }
            }
            .navigationTitle(siteName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss(); onDismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { updateEntry() }
                }
            }
            .alert("Delete Entry?", isPresented: $showDeleteConfirm) {
                Button("Delete", role: .destructive) { deleteEntry() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently remove \"\(siteName)\" from your vault.")
            }
        }
    }

    private func updateEntry() {
        guard let key = authService.getEncryptionKey(),
              let entryId = entry.entry.id else {
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

            var updated = entry.entry
            updated.uuid = siteName
            updated.dataBlob = ciphertext
            updated.nonce = nonce
            updated.updatedAt = now
            updated.syncVersion += 1

            try DatabaseService.shared.updateEntry(updated)
            dismiss()
            onDismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteEntry() {
        guard let entryId = entry.entry.id else { return }
        do {
            try DatabaseService.shared.softDeleteEntry(id: entryId, profileId: entry.entry.profileId)
            dismiss()
            onDismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

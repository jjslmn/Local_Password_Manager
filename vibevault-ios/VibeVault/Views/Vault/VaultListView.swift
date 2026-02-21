import SwiftUI

struct VaultListView: View {
    @EnvironmentObject var authService: AuthService
    @State private var entries: [DisplayEntry] = []
    @State private var searchText = ""
    @State private var showAddEntry = false
    @State private var selectedEntry: DisplayEntry?
    @State private var showSync = false

    private var filteredEntries: [DisplayEntry] {
        if searchText.isEmpty { return entries }
        return entries.filter {
            $0.siteName.localizedCaseInsensitiveContains(searchText) ||
            ($0.data.username?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            List(filteredEntries) { entry in
                Button {
                    selectedEntry = entry
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.siteName)
                            .fontWeight(.semibold)
                        if let username = entry.data.username, !username.isEmpty {
                            Text(username)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search entries...")
            .navigationTitle("My Vault")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showSync = true
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button {
                            showAddEntry = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        Button {
                            authService.logout()
                        } label: {
                            Image(systemName: "lock")
                        }
                    }
                }
            }
            .sheet(isPresented: $showAddEntry) {
                AddEntryView(profileId: authService.activeProfileId) {
                    loadEntries()
                }
            }
            .sheet(item: $selectedEntry) { entry in
                EntryDetailView(entry: entry) {
                    loadEntries()
                    selectedEntry = nil
                }
            }
            .sheet(isPresented: $showSync) {
                SyncView()
            }
            .onAppear {
                loadEntries()
            }
        }
    }

    private func loadEntries() {
        guard let key = authService.getEncryptionKey() else { return }
        do {
            let rawEntries = try DatabaseService.shared.getActiveEntries(profileId: authService.activeProfileId)
            entries = rawEntries.compactMap { entry in
                let data: VaultEntryData
                if entry.nonce.isEmpty {
                    // Legacy plaintext
                    data = (try? JSONDecoder().decode(VaultEntryData.self, from: entry.dataBlob)) ?? VaultEntryData()
                } else {
                    guard let plaintext = try? CryptoService.decrypt(entry.dataBlob, nonce: entry.nonce, key: key) else {
                        return nil
                    }
                    data = (try? JSONDecoder().decode(VaultEntryData.self, from: plaintext)) ?? VaultEntryData()
                }
                return DisplayEntry(entry: entry, data: data)
            }
        } catch {
            print("Failed to load entries: \(error)")
        }
    }
}

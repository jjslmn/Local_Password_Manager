import SwiftUI

@main
struct VibeVaultApp: App {
    @StateObject private var authService = AuthService()

    init() {
        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authService)
        }
    }
}

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        Group {
            if authService.isAuthenticated {
                VaultListView()
            } else if authService.isRegistered {
                LoginView()
            } else {
                RegisterView()
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            authService.checkRegistration()
        }
    }
}

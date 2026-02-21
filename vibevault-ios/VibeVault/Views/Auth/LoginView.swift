import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authService: AuthService
    @State private var username = ""
    @State private var password = ""
    @State private var error = ""
    @State private var showBiometricOption = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("VibeVault")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("Unlock your vault")
                .foregroundColor(.secondary)

            VStack(spacing: 12) {
                TextField("Username", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.username)
                    .autocapitalization(.none)

                SecureField("Master Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.password)
            }
            .padding(.horizontal, 40)
            .padding(.top, 20)

            if !error.isEmpty {
                Text(error)
                    .foregroundColor(.red)
                    .font(.footnote)
            }

            Button("Unlock Vault") {
                login()
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.large)

            if showBiometricOption {
                Button("Unlock with Face ID") {
                    Task { await unlockBiometric() }
                }
                .foregroundColor(.purple)
                .padding(.top, 8)
            }

            Spacer()
        }
        .onAppear {
            // Check if biometric key is stored
            showBiometricOption = (try? KeychainService.retrieve(key: .encryptionKey)) != nil
        }
    }

    private func login() {
        do {
            try authService.login(username: username, password: password)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func unlockBiometric() async {
        do {
            try await authService.unlockWithBiometrics()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

import SwiftUI

struct RegisterView: View {
    @EnvironmentObject var authService: AuthService
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var error = ""

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("VibeVault")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("Create your Master Account")
                .foregroundColor(.secondary)

            VStack(spacing: 12) {
                TextField("Username", text: $username)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.username)
                    .autocapitalization(.none)

                SecureField("Master Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.newPassword)

                SecureField("Confirm Password", text: $confirmPassword)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.newPassword)
            }
            .padding(.horizontal, 40)
            .padding(.top, 20)

            if !error.isEmpty {
                Text(error)
                    .foregroundColor(.red)
                    .font(.footnote)
            }

            Button("Create Account") {
                register()
            }
            .buttonStyle(.borderedProminent)
            .tint(.purple)
            .controlSize(.large)

            Spacer()
        }
    }

    private func register() {
        guard !username.isEmpty, !password.isEmpty else {
            error = "All fields are required"
            return
        }
        guard password == confirmPassword else {
            error = "Passwords don't match"
            return
        }
        guard password.count >= 8 else {
            error = "Password must be at least 8 characters"
            return
        }

        do {
            try authService.register(username: username, password: password)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

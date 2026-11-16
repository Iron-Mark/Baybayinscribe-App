# BaybayinScribe Client

[![Verification](https://img.shields.io/badge/verification-local_only-lightgrey)](docs/security-maintenance.md)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/UMak-Gilas-Tech/baybayinscribe-client/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

BaybayinScribe is an application for working with the ancient Philippine script called Baybayin. This client application provides a user-friendly interface for interacting with Baybayin.

This revival fork keeps the legacy app usable as a guest showcase. If the original
content service is unavailable, clearly labelled bundled samples demonstrate a
lesson and quiz without creating accounts or saving scores. They are not a
recovery of the original course database. See [guest mode](docs/guest-mode.md)
for scope, verification and the separate production migration/provider gates.

[View Showcase](https://baybayinscribe-client-showcase.vercel.app) · [Report Bug](https://github.com/Iron-Mark/baybayinscribe-client-showcase/issues) · [Original Project](https://github.com/UMak-Gilas-Tech/baybayinscribe-client)

## Table of Contents

- [About](#about)
  - [Features](#features)
  - [Built With](#built-with)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
    - [Installing Bun](#installing-bun)
    - [Web Development Setup](#web-development)
    - [Android Development Setup](#android-development)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Android Configuration](#android-configuration)
  - [Push Notifications](#push-notifications)
- [Usage](#usage)
- [Testing](#testing)
- [Deployment](#deployment)
  - [Web Deployment](#web-deployment)
  - [Android Deployment](#android-deployment)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

## About

BaybayinScribe is dedicated to preserving and promoting the ancient Filipino writing system of Baybayin. Our application makes learning, translating, and working with this script accessible to everyone.

### Features

- Baybayin character recognition with ML-powered image processing
- Text translation between Latin alphabet and Baybayin script
- Interactive tutorials for learning Baybayin characters and pronunciation
- User-friendly interface for learning and practicing Baybayin
- Cross-platform support (Web and Mobile)
- Push notifications for practice reminders (Android)
- Offline capability for learning on the go
- [Guest showcase mode](docs/guest-mode.md) for public learning and local practice without login; account saves and live AI remain protected.

### Built With

- [Next.js](https://nextjs.org/)
- [React](https://reactjs.org/)
- [Capacitor](https://capacitorjs.com/)
- [TensorFlow.js](https://www.tensorflow.org/js) (for character recognition)

## Getting Started

Follow these instructions to set up the project locally for development and testing purposes.

### Prerequisites

Before you begin, ensure you have the following installed:
- [Bun](https://bun.sh/) (latest version)
- [Android Studio](https://developer.android.com/studio) (for Android development)
- [JDK 11](https://www.oracle.com/java/technologies/javase-jdk11-downloads.html) or later
- [Git](https://git-scm.com/)

### Installation

#### Installing Bun

1. Install Bun using one of the following methods:

   **macOS or Linux:**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

   **Windows (via WSL):**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
   
   **Windows (via PowerShell):**
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   **Using npm (if you already have Node.js):**
   ```bash
   npm install -g bun
   ```

2. Verify installation:
   ```bash
   bun --version
   ```

#### Web Development

1. Clone the repository:
   ```bash
   git clone https://github.com/UMak-Gilas-Tech/baybayinscribe-client.git
   cd baybayinscribe-client
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your configuration values.

4. Start the development server:
   ```bash
   bun run dev
   ```

5. Open your browser and navigate to `http://localhost:3000`

#### Android Development

1. Follow the Web Development steps 1-3 above

2. Install Capacitor CLI if not already installed:
   ```bash
   bun add -g @capacitor/cli
   ```

3. Build the web application:
   ```bash
   bun run build
   ```

4. Sync with Capacitor:
   ```bash
   bunx cap sync
   ```

5. Open the project in Android Studio:
   ```bash
   bunx cap open android
   ```

6. In Android Studio, click on the "Run" button to build and run the application on an emulator or connected device

## Project Structure

```
baybayinscribe-client/
├── android/                # Android-specific files
├── public/                 # Static assets
│   ├── fonts/              # Custom fonts including Baybayin
│   ├── images/             # Image assets
│   └── locales/            # Internationalization files
├── src/                    # Source files
│   ├── components/         # React components
│   │   ├── common/         # Shared components
│   │   ├── layout/         # Layout components
│   │   └── baybayin/       # Baybayin-specific components
│   ├── hooks/              # Custom React hooks
│   ├── context/            # React context providers
│   ├── pages/              # Next.js pages
│   │   ├── api/            # API routes
│   │   └── baybayin/       # Baybayin-related pages
│   ├── models/             # Data models and TypeScript types
│   ├── services/           # API and service functions
│   ├── utils/              # Utility functions
│   │   ├── baybayin/       # Baybayin conversion utilities
│   │   └── helpers/        # General helper functions
│   └── config/             # Configuration files
├── tests/                  # Test files
├── .next/                  # Next.js build output
├── capacitor.config.ts     # Capacitor configuration
├── tsconfig.json           # TypeScript configuration
└── bun.lockb               # Bun lock file
```

## Configuration

### Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_ANALYTICS_ID=your-analytics-id
NEXT_PUBLIC_ENVIRONMENT=development
```

For production, set these variables in your deployment environment.

### Android Configuration

Android-specific configurations can be modified in the following files:
- `android/gradle.properties` - Project-wide Gradle settings
- `android/app/build.gradle` - App-specific build settings
- `android/build.gradle` - Project-level build settings
- `capacitor.config.ts` - Capacitor configuration

### Push Notifications

To enable push notifications for Android:

1. Create a Firebase project in [Firebase Console](https://console.firebase.google.com/)
2. Download the `google-services.json` file
3. Place the file in the `android/app/` directory
4. Update the `capacitor.config.ts` with your Firebase settings:
   ```typescript
   plugins: {
     PushNotifications: {
       presentationOptions: ["badge", "sound", "alert"],
     },
   },
   ```

## Usage

After installation, you can:

1. Use the text translator to convert between Latin script and Baybayin
2. Take photos of Baybayin text to translate to Latin script
3. Practice writing Baybayin characters with the interactive tools
4. Complete lessons to improve your Baybayin knowledge

Detailed usage documentation is available [in the wiki](https://github.com/UMak-Gilas-Tech/baybayinscribe-client/wiki).

## Testing

For the dependency-security maintenance path, **npm and `package-lock.json`
are authoritative**. The historical `bun.lockb` is retained but is not refreshed
by this repair; do not use it to reproduce the repaired dependency graph. Use
Node.js 24 and the repository's `.npmrc` settings for frozen installs:

```bash
npm ci --ignore-scripts
npm run test:security
npm run lint
npm run typecheck
npm run build
npm audit
```

`test:security` runs local-only dependency compatibility checks. It does not send
email, open a database connection, call AI providers, or prove the complete
application works. This repository does not currently configure component or
end-to-end test scripts; the old `test:components`/`test:e2e` commands were not
executable verification gates.

Production builds enforce TypeScript and ESLint checks. Run the separate strict
gates too: lint rejects warnings, and typecheck regenerates Next.js route types
before checking source. Do not bypass these gates to publish. See
[security maintenance notes](docs/security-maintenance.md) for scope and limits.

Custom APIs enforce server-side session/role/ownership checks; lesson and quiz
editing requires an administrator. Before publishing this repair, review and
stage the [prepared auth-column migration](db/migrations/review/README.md).
It has not been applied, and local passing tests do not establish database or
full account-security readiness. See the security notes for remaining release gates.
Email edits use a [two-mailbox confirmation flow](docs/email-change.md); the current
address stays unchanged until verification completes. The ban-expiry timestamp
conversion is also prepared for review, not applied to a database.

## Deployment

### Web Deployment

1. Build the production bundle:
   ```bash
   bun run build
   ```

2. For hosting on Vercel:
   ```bash
   bunx vercel deploy
   ```

3. For other hosting platforms, deploy the `.next` directory according to their documentation.

### Android Deployment

1. Build the production web bundle:
   ```bash
   bun run build
   ```

2. Sync with Capacitor:
   ```bash
   bunx cap sync
   ```

3. Open Android Studio:
   ```bash
   bunx cap open android
   ```

4. Generate a signed APK:
   - In Android Studio, go to Build > Generate Signed Bundle / APK
   - Follow the wizard to create a keystore if you don't have one
   - Select APK or App Bundle based on your distribution needs
   - Complete the signing process

5. Upload to Google Play Store through the [Google Play Console](https://play.google.com/console)

## Troubleshooting

### Common Issues

1. **Gradle Sync Failed**
   - Ensure you have the correct JDK version installed
   - Update Gradle to the version specified in `android/gradle/wrapper/gradle-wrapper.properties`
   - Run `bunx cap sync` again after resolving issues

2. **Build Errors**
   - Reproduce the supported dependency graph: `npm ci --ignore-scripts`
   - Run `npm run lint` and `npm run typecheck`; repair the reported source errors
   - Rebuild: `npm run build` (do not clear caches unless evidence identifies corruption)

3. **API Connection Issues**
   - Verify your `.env.local` configuration
   - Check that the API server is running
   - Confirm network connectivity

For more troubleshooting help, see our [troubleshooting guide](https://github.com/UMak-Gilas-Tech/baybayinscribe-client/wiki/Troubleshooting).

## Security Considerations

- API keys and sensitive information should never be committed to the repository
- Use environment variables for all sensitive configuration
- Keep dependencies updated to avoid security vulnerabilities:
  ```bash
  bun update
  ```
- Regularly run security audits:
  ```bash
  bunx tenjin
  ```

## Contributing

We welcome contributions to BaybayinScribe! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add some amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

Read our [contribution guidelines](CONTRIBUTING.md) for more details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

Project Maintainer - [@UMak-Gilas-Tech](https://github.com/UMak-Gilas-Tech) - email@example.com

Project Link: [https://github.com/UMak-Gilas-Tech/baybayinscribe-client](https://github.com/UMak-Gilas-Tech/baybayinscribe-client)

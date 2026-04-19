# iOS Packaging Path

This project now includes an initial Capacitor setup so we can move the web app toward an iOS App Store build.

## Current stage

Stage 1 uses a Capacitor native shell that loads the production app from:

- `https://abc-vault-live-scanner.vercel.app`

This is the fastest way to create an iOS container and begin native testing, signing, icons, and TestFlight work without rewriting the current Vercel architecture.

## Files added

- `capacitor.config.json`
- `scripts/build-mobile-web.mjs`

## Commands

- `npm run build:mobile-web`
- `npm run cap:add:ios`
- `npm run cap:sync`
- `npm run cap:open:ios`

## Important note

The final iOS build and App Store submission still require macOS with Xcode installed.

This Windows machine can prepare the repository and Capacitor configuration, but opening the iOS workspace, signing the app, configuring icons, and uploading builds to App Store Connect must happen on a Mac.

## Recommended next stage

Stage 2 should switch the native shell from loading the live production URL to using bundled local assets from `mobile-web`, while keeping the API layer pointed at production. That would be a stronger App Store posture than shipping a thin remote website wrapper.

## Native polish checklist

- Add app icons in Xcode
- Add a launch screen that matches the app opening experience
- Configure the app bundle identifier and signing team
- Test on iPhone hardware
- Validate auth flow inside the native shell
- Confirm notification and external-link behavior
- Upload to TestFlight before App Store review

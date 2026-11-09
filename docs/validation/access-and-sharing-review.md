# Access and sharing review

Reviewed November 2026 against the current repository.

**Implementation update:** The initial findings below describe browser-local mode. A new opt-in server mode now provides PostgreSQL-backed users/sessions, admin roles, explicit study upload and expiring/revocable bearer report snapshots. See [server architecture and limitations](../../server/README.md). Hosted links require server mode and explicit upload; file sharing remains available locally. Recipient verification, MFA and recovery remain future work, not implied by the new login.

## Initial architecture findings (local-only mode)

The original Vite/React application stores studies in IndexedDB and has no server identity or sharing infrastructure. This remains the behavior of local-only mode. The new server build adds authenticated accounts, owner-scoped storage and share tokens. The radiologist name and local report signature remain editable local records, not verified identity or a cryptographic signature. Browser/OS access controls protect local data. Model calls can transmit images to the configured inference service.

Adding a password screen or a UUID to a URL would not establish access control. A local study URL cannot retrieve a study on another person's device. Patient data should not be encoded into query strings, fragment links, public paste services or analytics events as a shortcut.

## Implemented file-sharing path

The report's **Export & share → Share report & scans** action creates a portable HTML document. It previews report text, omits name/patient ID/referring physician and original file names by default, and includes display images only when selected. It does not claim full anonymization: clinical prose and burned-in image pixels may identify a patient. Signed patient snapshots are subject to the same explicit field omission. The original study is not mutated.

Users review contents and confirm the intended disclosure before downloading or invoking the operating system share picker when file sharing is supported. The app does not send a message itself. Download remains available when native sharing is unavailable or rejected. A downloaded copy cannot be revoked or expired. Server mode separately offers real expiring/revocable snapshot links after explicit upload; the file-export path does not imply those protections.

Exports escape report text, allow only embedded raster images, include no script or external resources, declare a restrictive content security policy, use generic filenames, and never embed the raw study JSON. Scan copies are the app's display pixels, not original DICOM and not a complete CT/MRI volume. Existing full-volume report export remains separate.

## Production target for account login and share links

The server foundation implements sessions, owner checks, hashed expiring grants and revocation. Recipient verification, SSO/MFA, object storage and broader policy controls below remain deployment/extension work. Executed integration results are recorded in [platform QC](2026-11-10-platform-qc.md).

1. Configure an organization-approved identity provider using OIDC authorization code + PKCE or a server session. Provide SSO, recovery, optional organizational MFA, visible account identity and explicit sign-out. Keep bearer credentials out of local storage; use server-managed secure HttpOnly sessions with CSRF protection where applicable.
2. Store studies and scan objects behind server-enforced organization and study permissions. Enforce authorization on every metadata, thumbnail, image, report and download request; client hiding is not access control.
3. Create recipient-specific grants through an authenticated endpoint. Use high-entropy opaque tokens whose hashes are stored server-side. Include study/version, allowed assets, expiry, creator, recipient verification policy and revocation state. Do not put patient identifiers in link URLs.
4. Default to verified-recipient, view-only, time-limited access. Resolve the link into a recipient session, check grant validity on each request, and provide explicit expired/revoked/incorrect-recipient states. Downloads require a separate permission; once downloaded, copies cannot be revoked.
5. Present a pre-share summary of patient, report state, selected images, recipient, expiry and download permission. Keep recipients and token metadata in an authenticated sharing panel with revoke action and a server-side access audit.
6. Use TLS, appropriate object storage encryption, restrictive cache/referrer policy, rate limiting and audit logging without patient text or raw tokens. Establish retention and deletion behavior before real patient deployment.

## Verification

`node --experimental-strip-types scripts/test-study-share.ts` covers signed identity omission, source immutability, explicit identity opt-in, script escaping, image opt-in, raster-only data URL validation, and rejection of remote images. The production TypeScript/Vite build passed after implementation. Native share targets depend on the browser and OS and cannot be asserted from the unit tests.

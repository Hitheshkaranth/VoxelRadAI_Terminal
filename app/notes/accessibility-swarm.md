# Shell accessibility and account security

Implemented a shared shadcn ShellButton across shell screens while retaining existing layout classes. Sheet now uses Radix Dialog for background isolation, trapped focus, stacked modal Escape handling and focus restoration. Settings remains mounted under analytics/saved-study dialogs so their trigger remains available. Inspector uses Radix Tabs for arrow/Home/End navigation and panel relationships.

Added coarse-pointer/mobile 44px targets, visible keyboard outlines, safe-area dialog sizing, reduced-motion support, and always-visible row actions on touch. Sidebar rename Escape no longer commits on blur; cancel/rename restores focus. Inline deletion confirmation starts on Cancel and handles Escape.

Added administrator-issued recovery-code UI, login recovery, and signed-in password change. Credentials and recovery codes use same-origin POST bodies only; no persistent storage or URL token handling. Password change clears client session and reloads after the server revokes sessions. Recovery code generation requires administrator password reauthentication. Settings version comes from the package version.

Validation: account security boundary tests pass; TypeScript typecheck and lint completed without errors. Root owns browser validation; keyboard traversal, touch behavior and recovery forms should be inspected in the running app. This does not constitute a comprehensive assistive-technology audit.

Added Server operations to the Organization analytics view. It displays actual process-scoped request counts/durations, RSS, database pool counts, response classes and explicit capability flags from `/api/admin/operations`. The UI states that counters reset and may come from different replicas; unsupported features show Not implemented. Boundary tests reject aggregate scope, malformed counts, invalid flags and strip unknown fields. shadcn's MIT notice remains intact; ShellButton forwards refs and native/Radix props, and its icon sizing does not hide SVGs. Root verified the modal keyboard/focus path in the browser.

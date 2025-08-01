# Security Tracking

## Known Vulnerabilities

### RSA Timing Sidechannel (RUSTSEC-2023-0071)
- **Severity**: Medium (5.9)
- **Status**: No fix available yet
- **Path**: `rsa 0.9.8` via `sqlx-mysql 0.8.6` → `sqlx 0.8.6`
- **Impact**: Potential key recovery through timing sidechannels (Marvin Attack)
- **Mitigation**: This is a transitive dependency through sqlx. Monitor for updates to sqlx that include a fixed version of the rsa crate.
- **Tracking**: Run `cargo audit` periodically to check when a fix becomes available.

### GTK3 Unmaintained Warnings
- **Status**: Warnings only (not vulnerabilities)
- **Impact**: Linux builds only
- **Note**: These are from Tauri's Linux dependencies and don't affect macOS/Windows builds.

## Security Checks

Run the following command to check for new vulnerabilities:
```bash
cargo audit
```

## Updating Dependencies

When security updates become available:
```bash
cargo update
cargo audit
```
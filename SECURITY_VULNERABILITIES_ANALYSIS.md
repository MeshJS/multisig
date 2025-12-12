# Security Vulnerabilities Analysis

## Overview
This document traces the origin of all security vulnerabilities identified in the project's dependency tree.

## Vulnerability Summary
- **Total Vulnerabilities**: 14 (1 low, 13 high)
- **Fixed**: 9 vulnerabilities (reduced from 23)
- **Remaining**: 14 vulnerabilities

---

## 1. `ip` Package Vulnerability (High Severity)

### Vulnerability Details
- **CVE**: SSRF improper categorization in `isPublic` function
- **Affected Version**: `ip@2.0.1`
- **Risk**: Server-Side Request Forgery (SSRF) attacks possible

### Dependency Chain
```
Root Project
└── @meshsdk/react@1.9.0-beta.87
    └── @fabianbormann/cardano-peer-connect@1.2.18
        └── @fabianbormann/meerkat@1.0.18
            └── webtorrent@2.8.5
                ├── bittorrent-tracker@11.2.2
                │   └── ip@2.0.1 ⚠️ VULNERABLE
                └── load-ip-set@3.0.1
                    └── ip-set@2.2.0
                        └── ip@2.0.1 ⚠️ VULNERABLE
```

### Root Cause
The `ip` package is pulled in by **WebTorrent**, which is used for peer-to-peer (P2P) connectivity in Cardano wallet connections. This is a transitive dependency from:
- `@fabianbormann/cardano-peer-connect` → Used by MeshSDK for P2P wallet connections
- `webtorrent` → BitTorrent protocol implementation for P2P networking
- `bittorrent-tracker` → Tracker client that uses `ip` for IP address validation

### Impact Assessment
- **Usage**: Only used when P2P wallet connection features are active
- **Risk Level**: Medium-Low (only affects P2P connectivity features)
- **Attack Vector**: Requires attacker to control IP addresses in P2P network context

### Mitigation Options
1. **Wait for upstream fix**: Monitor `@fabianbormann/cardano-peer-connect` for updates
2. **Use npm overrides**: Force a patched version of `ip` (risky, may break functionality)
3. **Disable P2P features**: If not needed, consider removing MeshSDK P2P functionality
4. **Contact maintainers**: Report to MeshSDK team about dependency updates

---

## 2. `brace-expansion` Vulnerability (ReDoS)

### Vulnerability Details
- **CVE**: Regular Expression Denial of Service (ReDoS)
- **Affected Versions**: `1.0.0 - 1.1.11 || 2.0.0 - 2.0.1`
- **Risk**: CPU exhaustion through malicious regex patterns

### Dependency Chain
```
Root Project
└── @meshsdk/core-cst@1.9.0-beta.87
    └── @cardano-sdk/crypto@0.2.3
        └── npm@9.9.4 ⚠️ BUNDLED DEPENDENCY
            ├── minimatch@9.0.3
            │   └── brace-expansion@2.0.1 ⚠️ VULNERABLE
            └── node-gyp@9.4.1
                ├── glob@7.2.3
                │   └── minimatch@3.1.2
                │       └── brace-expansion@1.1.11 ⚠️ VULNERABLE
                └── cacache@16.1.3
                    └── glob@8.1.0
                        └── minimatch@5.1.6
                            └── brace-expansion@2.0.1 ⚠️ VULNERABLE
```

### Root Cause
**Critical Finding**: `@cardano-sdk/crypto@0.2.3` includes `npm@^9.3.0` as a **production dependency**. This is highly unusual and problematic because:

1. **npm should not be a dependency**: npm is a package manager, not a library
2. **Bundled vulnerabilities**: npm@9.9.4 bundles vulnerable versions of `brace-expansion` and `glob`
3. **Cannot be fixed via project dependencies**: These are bundled inside npm itself

### Why npm is a dependency
The `@cardano-sdk/crypto` package likely uses npm for:
- Build tooling or scripts
- Package management utilities
- Development tooling (incorrectly marked as production dependency)

**This is a bug/misconfiguration in the Cardano SDK package.**

### Impact Assessment
- **Usage**: Likely only used during build/development, not runtime
- **Risk Level**: Low-Medium (ReDoS requires specific attack patterns)
- **Attack Vector**: Requires attacker to provide malicious input to brace expansion functions

### Mitigation Options
1. **Update npm globally**: `npm install -g npm@latest` (fixes bundled dependencies)
2. **Report to Cardano SDK**: This is a packaging issue that should be fixed upstream
3. **Use npm overrides**: Force newer versions (may break npm functionality)
4. **Consider alternative**: Evaluate if `@cardano-sdk/crypto` is necessary or if there's an alternative

---

## 3. `glob` Vulnerability (High Severity)

### Vulnerability Details
- **CVE**: Command injection via `-c/--cmd` executes matches with `shell:true`
- **Affected Versions**: `glob@10.2.0 - 10.4.5`
- **Risk**: Command injection attacks

### Dependency Chain
```
Root Project
└── @meshsdk/core-cst@1.9.0-beta.87
    └── @cardano-sdk/crypto@0.2.3
        └── npm@9.9.4 ⚠️ BUNDLED DEPENDENCY
            ├── glob@10.3.10 ⚠️ VULNERABLE
            └── node-gyp@9.4.1
                └── (uses older glob versions)
```

### Root Cause
Same as `brace-expansion` - bundled in npm@9.9.4 which is incorrectly included as a dependency of `@cardano-sdk/crypto`.

### Impact Assessment
- **Usage**: Only if npm CLI features are used at runtime (unlikely)
- **Risk Level**: Low (requires CLI usage with malicious input)
- **Attack Vector**: Command injection through glob CLI usage

### Mitigation Options
Same as `brace-expansion` - update npm globally or report to Cardano SDK maintainers.

---

## 4. Previously Fixed Vulnerabilities

### ✅ `axios` (Fixed)
- **Was**: Vulnerable versions in `@cardano-sdk/util-dev`
- **Fixed**: Updated MeshSDK packages to `1.9.0-beta.87`
- **Status**: Resolved

### ✅ `tar-fs` (Fixed)
- **Was**: Vulnerable versions in `dockerode`
- **Fixed**: Updated MeshSDK packages
- **Status**: Resolved

---

## Recommendations

### Immediate Actions
1. ✅ **Update MeshSDK packages** - Already completed (all at `1.9.0-beta.87`)
2. ⚠️ **Update npm globally**: `npm install -g npm@latest`
3. 📝 **Report to Cardano SDK**: File issue about npm being a production dependency

### Long-term Actions
1. **Monitor dependencies**: Set up automated dependency scanning
2. **Evaluate alternatives**: Consider if Cardano SDK crypto package is necessary
3. **Review P2P features**: Assess if `cardano-peer-connect` is required for your use case
4. **Use npm overrides**: If needed, add overrides for critical vulnerabilities (with caution)

### npm Overrides Example (Use with Caution)
```json
{
  "overrides": {
    "ip": "^2.0.2",
    "brace-expansion": "^2.0.2",
    "glob": "^10.4.6"
  }
}
```

---

## Dependency Tree Visualization

### Critical Paths
```
Root → @meshsdk/react → @fabianbormann/cardano-peer-connect → webtorrent → ip ⚠️
Root → @meshsdk/core-cst → @cardano-sdk/crypto → npm → brace-expansion/glob ⚠️
```

### Key Packages
- **@meshsdk/react**: Main MeshSDK React integration
- **@fabianbormann/cardano-peer-connect**: P2P wallet connectivity
- **@cardano-sdk/crypto**: Cryptographic utilities (incorrectly includes npm)
- **webtorrent**: BitTorrent protocol for P2P
- **npm**: Package manager (should not be a dependency!)

---

## Conclusion

The security vulnerabilities stem from:
1. **Transitive dependencies** in MeshSDK's P2P connectivity features (`ip` vulnerability)
2. **Packaging error** in Cardano SDK (`npm` as production dependency causing `brace-expansion`/`glob` issues)

Most vulnerabilities are low-risk for production use, but should be addressed through:
- Updating npm globally
- Reporting issues to upstream maintainers
- Monitoring for package updates


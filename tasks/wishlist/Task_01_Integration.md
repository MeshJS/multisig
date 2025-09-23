# Task: Summon Platform Ejection Integration

## 1. Task Overview
**Ejection system for users from Summon platform with staking key-based payment credentials**

### Problem Statement
- **What problem does this solve?**: Users from the Summon platform (being shutdown) need to eject their multisig wallets that sometimes reuse staking keyhashes as payment credentials, breaking our current logic that expects separate payment keys
- **Who is affected by this problem?**: Users ejecting from Summon platform, governance participants, DeFi users with staking-integrated wallets
- **What is the current state vs. desired state?**: Current state has incompatible wallet validation and creation logic; desired state supports seamless ejection with staking key compatibility

### Solution Overview
- **High-level description**: Create an ejection integration that handles staking key-based payment credentials with a redirect endpoint that prefills the wallet creation flow
- **Key benefits**: Seamless user ejection, preserved wallet functionality, enhanced platform compatibility

## 2. Requirements

### User Stories
```
As a user on Summon platform, I want to eject my multisig wallet so that I can continue using it on the Mesh multisig platform.

As a user with staking key-based payment credentials, I want the system to recognize and properly handle my wallet configuration so that all features work correctly.

As a user ejecting from Summon, I want the wallet creation flow to be prefilled with my existing wallet data so that the transition is seamless.

As a platform administrator, I want to validate ejected wallet data against Summon's records so that only legitimate wallets are created.
```

### Functional Requirements
- **FR-1**: Redirect endpoint that accepts ejection parameters and prefills wallet creation flow
- **FR-2**: Staking key detection and validation system
- **FR-3**: Payment credential logic that handles both traditional and staking key-based credentials
- **FR-4**: Ejection validation and error handling with Summon data verification
- **FR-5**: Locked wallet creation flow (no adding new signers) to preserve existing multisig structure
- **FR-6**: Wallet address validation against Summon's original data

### Non-Functional Requirements
- **NFR-1**: Ejection process must complete within 5 minutes, system must handle concurrent ejections without performance degradation
- **NFR-2**: Full accessibility for ejection flow, WCAG 2.1 AA compliance, screen reader support
- **NFR-3**: All existing functionality must remain unaffected, comprehensive logging and monitoring

## 3. Technical Specifications

### Architecture Overview
- **Ejection Service**: Handles wallet validation and data transformation from Summon
- **Redirect Handler**: Processes incoming ejection requests and prefills wallet creation data
- **Key Compatibility Layer**: Manages different credential types and their interactions
- **Validation Engine**: Ensures ejected wallets meet system requirements and match Summon data

### API Specifications
- **Endpoints and methods**: POST `/api/v1/ejection/redirect`
- **Request/response schemas**: JSON with wallet_data, summon_validation_token, rate_limit_info, wallet_connection_required fields
- **Authentication and authorization**: Rate limiting with wallet connection requirement for wallet creation

### Database Schema
- **Entity relationships**: No schema changes needed - existing Wallet model supports ejection
- **Key tables and fields**: signersAddresses, signersStakeKeys, scriptCbor, stakeCredentialHash
- **Data ejection requirements**: Populate both payment and staking key arrays appropriately, mark as ejected from Summon

### Integration Points
- **External services/APIs**: Summon platform API for ejection validation, rate limiting service for request throttling
- **Third-party dependencies**: Mesh SDK for address resolution, wallet connection libraries
- **Internal system integrations**: Wallet connection system, wallet management, staking infrastructure

## 4. Implementation Plan

### Development Phases
- **Phase 1**: Compatibility layer and address resolution (Week 1)
- **Phase 2**: Ejection redirect endpoint and prefill system (Week 2)
- **Phase 3**: Core logic updates and locked wallet creation flow (Week 3-4)
- **Phase 4**: Testing and validation with Summon integration (Week 5)
- **Phase 5**: Deployment and monitoring (Week 6)

### Dependencies
- **External dependencies**: Summon platform API access for validation, rate limiting service configuration, wallet connection libraries
- **Internal team dependencies**: Frontend team for UI updates, backend team for API development
- **Infrastructure requirements**: Database access, API gateway updates

### Risk Assessment
- **High Risk**: Breaking existing wallet functionality during compatibility updates
- **Medium Risk**: Performance impact of additional validation logic, Summon API dependency
- **Low Risk**: User experience issues with ejection flow

## 5. Testing Strategy

### Test Cases
- **TC-1**: Successful ejection of staking key-based wallet from Summon
- **TC-2**: Validation of incompatible wallet configurations
- **TC-3**: Redirect endpoint with various parameter combinations from Summon
- **TC-4**: Error handling for rate limit exceeded and wallet connection failures
- **TC-5**: Performance testing with concurrent ejections
- **TC-6**: Locked wallet creation flow (no adding new signers)
- **TC-7**: Wallet address validation against Summon's original data

### Testing Types
- **Unit testing**: Individual component validation
- **Integration testing**: End-to-end ejection flow
- **End-to-end testing**: Complete user journey testing from Summon to Mesh
- **Performance testing**: Concurrent ejection load testing
- **Security testing**: Rate limiting validation and wallet connection security

### Acceptance Criteria
- **Definition of Done**: All staking key-based wallets successfully eject from Summon, no regression in existing functionality
- **Quality gates**: Ejection success rate >95%, error rate <1%
- **Performance benchmarks**: Ejection completion within 5 minutes

## 6. Code Analysis & Implementation Details

### Key Issues Identified
- **Issue 1**: Payment credential resolution fails for staking key addresses (`src/utils/common.ts:35`)
- **Issue 2**: Address validation functions reject staking key-based addresses (`src/utils/multisigSDK.ts:303-310`)
- **Issue 3**: Native script generation assumes payment key hashes exist (`src/utils/common.ts:97-103`)
- **Issue 4**: Multisig wallet building doesn't handle staking key as payment credential (`src/utils/common.ts:20-81`)
- **Issue 5**: Wallet creation flow needs to be locked to prevent adding new signers for ejected wallets

### Code References
- **Files to Modify**: 
  - `src/utils/common.ts` - Core wallet building logic
  - `src/hooks/common.ts` - Hook-based wallet building
  - `src/utils/multisigSDK.ts` - Address validation functions
  - `src/pages/wallets/new-wallet-flow/` - UI components
  - `src/pages/api/v1/` - New ejection endpoint
- **Rate Limiting Integration**: Implement rate limiting middleware, follow CORS pattern from `src/lib/cors.ts`
- **Frontend Integration**: Extend existing wallet flow state management in `src/components/pages/homepage/wallets/new-wallet-flow/shared/useWalletFlowState.tsx`

### Implementation Examples
```typescript
// src/utils/addressCompatibility.ts
export function resolveKeyHash(address: string): { keyHash: string; role: number; type: 'payment' | 'staking' } {
  try {
    const paymentHash = resolvePaymentKeyHash(address);
    return { keyHash: paymentHash, role: 0, type: 'payment' };
  } catch {
    try {
      const stakeHash = resolveStakeKeyHash(address);
      return { keyHash: stakeHash, role: 0, type: 'staking' }; // Use as payment credential
    } catch {
      throw new Error('Invalid address format');
    }
  }
}

// src/pages/api/v1/ejection/redirect.ts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Apply rate limiting (e.g., 10 requests per minute per IP)
  // 2. Validate Summon ejection token
  // 3. Extract wallet configuration data from Summon
  // 4. Detect staking key compatibility issues
  // 5. Validate wallet address against Summon's original data
  // 6. Generate prefill data for locked wallet creation flow
  // 7. Return redirect URL: /wallets/invite/{inviteId} with prefill parameters
  // 8. Require wallet connection before allowing wallet creation
}
```

## 7. Next Steps
1. **Create Compatibility Layer**: Implement enhanced address resolution functions
2. **Build Ejection Endpoint**: Create API endpoint with rate limiting and wallet connection requirements
3. **Update Core Logic**: Modify wallet building and validation functions
4. **Frontend Integration**: Update UI components to handle staking key addresses and locked wallet creation
5. **Testing**: Comprehensive testing with real ejection scenarios from Summon
# Task 02: User Page and Registration Flow

## 1. Task Overview
**Implement a comprehensive user registration and authentication flow with a dedicated User Page, utilizing nonce-based authentication and addressing wallet connection bugs.**

### Problem Statement
- **Current Issue**: Users experience authentication bugs when initially connecting their wallet on new devices
- **Missing UX**: No dedicated user registration flow or user management page
- **Authentication Gap**: The current system auto-creates users but doesn't handle the authentication flow properly for new devices
- **State Management**: User state is managed but lacks proper registration/onboarding flow

### Solution Overview
- **User Registration Modal**: Simple, intuitive registration flow for new users
- **Nonce-Based Authentication**: Secure authentication using wallet signature verification
- **User Page**: Dedicated page for user profile management and settings
- **Bug Resolution**: Fix wallet connection authentication issues on new devices

## 2. Requirements

### User Stories
```
As a new user, I want to register my wallet securely so that I can access the multisig platform
As an existing user, I want to authenticate on a new device so that I can access my wallets and data
As a user, I want to manage my profile and settings so that I can customize my experience
As a user, I want a smooth wallet connection experience so that I don't encounter authentication bugs
As a user, I want to see human-readable names (AdaHandles) instead of long wallet addresses so that I can easily identify users
As a user, I want the system to find my account using either my wallet address or stake key so that I can access my data regardless of which identifier I have
```

### Functional Requirements
- **FR-1**: User Registration Modal - Modal-based registration flow for new users
- **FR-2**: Nonce Authentication Flow - Secure nonce-based authentication for new devices
- **FR-3**: User Profile Page - Dedicated page for user management and settings
- **FR-4**: Wallet Connection Bug Fix - Resolve authentication issues on initial wallet connection
- **FR-5**: State Management Integration - Seamless integration with existing zustand user store
- **FR-6**: Authentication Persistence - Proper session management and token handling
- **FR-7**: AdaHandle Name Inference - Display human-readable names from AdaHandle integration
- **FR-8**: Stake Key Flexibility - Support user lookup by both address and stake key for better wallet compatibility

### Non-Functional Requirements
- **NFR-1**: Security - Cryptographic signature verification for all authentication
- **NFR-2**: UX/UI - Intuitive, modern interface following existing design patterns
- **NFR-3**: Performance - Fast authentication flow with minimal loading states
- **NFR-4**: Compatibility - Works with all supported Cardano wallets
- **NFR-5**: Accessibility - WCAG compliant interface components

## 3. Technical Specifications

### Architecture Overview
- **Frontend**: React components with TypeScript, Zustand state management
- **Authentication**: Nonce-based signature verification using Mesh SDK
- **Backend**: Existing tRPC API with JWT token management
- **Database**: Prisma ORM with existing User and Nonce models

### API Specifications
**Existing Endpoints to Utilize:**
- `GET /api/v1/getNonce?address={address}` - Request nonce for address
- `POST /api/v1/authSigner` - Verify signature and get JWT token
- `api.user.getUserByAddress` - Get user by address
- `api.user.getUserByStakeKey` - Get user by stake key for better flexibility
- `api.user.createUser` - Create new user

**New Endpoints Needed:**
- `api.user.updateUser` - Update user profile information
- `api.user.deleteUser` - Delete user account (optional)

### Database Schema
**Existing Models:**
```prisma
model User {
  id           String @id @default(cuid())
  address      String @unique
  stakeAddress String @unique
  nostrKey     String @unique
  discordId    String @default("")
}

model Nonce {
  id        String   @id @default(cuid())
  address   String   @unique
  value     String
  createdAt DateTime @default(now())
}
```

**Potential Additions:**
- displayName field for user-friendly names
- email field for contact information
- lastLoginAt timestamp for activity tracking
- isActive boolean for account status
- preferences JSON field for user settings

### Integration Points
- **Mesh SDK**: Wallet connection and signature verification
- **Zustand Store**: User state management and persistence
- **tRPC**: API communication and type safety
- **Next.js**: Routing and page management
- **JWT**: Token-based authentication
- **AdaHandle API**: Name resolution for human-readable wallet identification

## 4. Implementation Plan

### Development Phases (UI-First Approach)
- **Phase 1**: User Registration Modal UI (Week 1)
  - Create registration modal component with mock data
  - Design nonce-based authentication flow UI
  - Implement modal states and transitions
  - Basic zustand store integration
- **Phase 2**: User Profile Page UI (Week 2)
  - Create user profile page layout and components
  - Design user settings interface
  - Implement profile display with mock data
  - Add navigation and routing
- **Phase 3**: UI Polish and Integration (Week 3)
  - Refine user experience and interactions
  - Add loading states and error handling
  - Connect to existing wallet connection flow
  - Minimal API integration for essential features

### Dependencies
- **External**: Mesh SDK for wallet connection (minimal integration)
- **Internal**: Zustand user store, existing UI components, mock data
- **Infrastructure**: No database changes needed initially

### Risk Assessment
- **Low Risk**: UI component implementation and styling
- **Low Risk**: Mock data integration and state management
- **Medium Risk**: Integration with existing wallet connection flow

## 5. Testing Strategy

### Test Cases
- **TC-1**: User registration modal UI flow and states
- **TC-2**: User profile page display and navigation
- **TC-3**: Modal interactions and transitions
- **TC-4**: Zustand store integration with mock data
- **TC-5**: UI responsiveness and accessibility

### Testing Types
- **Unit Testing**: Individual component functionality
- **Integration Testing**: Zustand store and component integration
- **UI Testing**: Component rendering and user interactions
- **Accessibility Testing**: WCAG compliance and keyboard navigation

### Acceptance Criteria
- Registration modal displays correctly with proper states
- User profile page renders with mock data
- Modal interactions work smoothly (open, close, transitions)
- Zustand store integration functions properly
- UI is responsive and accessible
- Components follow existing design patterns

## 6. Code Analysis & Implementation Details

### Key Issues Identified
- **Issue 1**: No user registration UI flow for new users
- **Issue 2**: Missing user profile management interface
- **Issue 3**: Wallet connection state not properly reflected in UI
- **Issue 4**: No dedicated user management page

### Code References
**Files to Modify:**
- `src/lib/zustand/user.ts` - Add registration state management
- `src/hooks/useUser.ts` - Enhance user hook with registration logic

**New Files to Create:**
- `src/components/pages/user/` - User profile page components
- `src/components/common/user-registration-modal.tsx` - Registration modal
- `src/hooks/useUserRegistration.ts` - Registration logic hook
- `src/pages/user/index.tsx` - User profile page
- `src/data/mockUserData.ts` - Mock user data for development

### Component Specifications

**User Registration Modal:**
- Multi-step modal with welcome, nonce generation, signature, and completion states
- Visual icons and progress indicators for each step
- Mock data integration for development without API dependencies
- Smooth transitions between states with loading indicators
- Responsive design with proper spacing and typography

**Enhanced User Hook:**
- Registration state management with modal visibility control
- Skip registration option for testing and development
- Integration with existing user store and wallet connection
- Mock data fallback when real user data is unavailable
- Support for both address and stake key lookup methods

**User Profile Page:**
- Two-column layout with account information and settings
- Account information card showing wallet and stake addresses with AdaHandle name resolution
- Settings card with Discord integration, notifications, and theme toggles
- Recent activity feed with mock activity data
- Responsive design with proper card layouts and spacing
- AdaHandle display with fallback to wallet address when no handle is found



## 7. Next Steps (UI-First Implementation)
1. **Step 1**: Create user registration modal component
2. **Step 2**: Implement enhanced user hook with registration state management
3. **Step 3**: Create user profile page 
4. **Step 4**: Add mock user data and state management
5. **Step 5**: Implement modal interactions and transitions
6. **Step 6**: Add navigation and routing for user page
7. **Step 7**: Integrate AdaHandle name resolution for human-readable wallet identification
8. **Step 8**: Implement stake key lookup functionality for better wallet compatibility

---

## Implementation Priority (UI-First)

### High Priority (Week 1)
- User registration modal UI with mock data
- Enhanced user state management with Zustand
- Modal interactions and transitions

### Medium Priority (Week 2)
- User profile page implementation with mock data
- Settings and preferences UI
- Navigation and routing
- AdaHandle name resolution integration
- Stake key lookup functionality implementation

### Low Priority (Week 3)
- API integration (when ready)
- Advanced user features
- Performance optimizations

## Success Metrics (UI-First)
- Registration modal displays correctly with all states
- User profile page renders with mock data
- Smooth modal interactions and transitions
- Proper state management integration
- Responsive and accessible UI components
- AdaHandle names display correctly with fallback to wallet addresses
- Human-readable identification improves user experience
- Users can be found using either wallet address or stake key
- Improved wallet compatibility and flexibility

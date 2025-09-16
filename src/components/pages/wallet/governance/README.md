# Governance Component

A comprehensive Cardano governance interface for multisig wallets with DRep management, proposal voting, ballot creation, and Clarity integration for advanced governance actions.

## Features

### DRep Management
- **DRep Registration**: Complete DRep registration with metadata and anchor creation
- **DRep Information**: Display DRep ID, registration status, and voting power
- **DRep Updates**: Update DRep metadata and information
- **DRep Retirement**: Retire from DRep role with proper certificate handling
- **External Links**: Direct links to gov.tools for DRep directory access
- **Voting Power Display**: Shows current voting power in ADA with proper formatting

### Proposal Management
- **Proposal Discovery**: Browse all community-submitted governance proposals
- **Proposal Details**: View proposal titles, authors, abstracts, and governance types
- **Proposal Metadata**: Rich metadata display with Markdown support
- **Pagination**: Load more proposals with efficient data fetching
- **Proposal Links**: Direct navigation to detailed proposal pages
- **Loading States**: Skeleton loading for better user experience

### Voting System
- **Individual Voting**: Vote on individual proposals with Yes/No/Abstain options
- **Ballot Creation**: Create custom ballots to group multiple proposals
- **Ballot Management**: Add/remove proposals from ballots with choice selection
- **Batch Voting**: Submit votes for all proposals in a ballot simultaneously
- **Vote Tracking**: Track voting choices and ballot status
- **Transaction Integration**: Create multisig transactions for all voting actions

### Ballot System
- **Ballot Creation**: Create named ballots for organizing multiple proposals
- **Proposal Addition**: Add proposals to ballots with individual vote choices
- **Choice Management**: Update vote choices for proposals within ballots
- **Ballot Overview**: Table view of all proposals and choices in a ballot
- **Batch Submission**: Submit all votes in a ballot as a single transaction
- **Ballot Deletion**: Remove ballots and clean up associated data

### Clarity Integration
- **API Key Management**: Store and manage Clarity API keys for organizations
- **Governance Actions**: Create new governance actions through Clarity platform
- **Organization Linking**: Connect multisig wallets to Clarity organizations
- **Action Creation**: Interface for creating complex governance actions
- **Status Tracking**: Monitor Clarity integration status and connectivity

### UTxO Management
- **UTxO Selection**: Manual and automatic UTxO selection for governance transactions
- **Balance Validation**: Ensure sufficient funds for governance operations
- **Transaction Building**: Proper UTxO handling for all governance transactions
- **Fee Management**: Automatic fee calculation and UTxO optimization

### Mobile Responsiveness
- **Floating Ballot Sidebar**: Mobile-optimized ballot management with floating interface
- **Responsive Tables**: Adaptive table layouts for different screen sizes
- **Touch-Friendly**: Optimized touch interactions for mobile devices
- **Collapsible Interface**: Expandable ballot sidebar for desktop and mobile
- **Notification Badges**: Visual indicators for pending ballots and proposals

## Component Structure

```
governance/
├── index.tsx                      # Main governance page component
├── card-info.tsx                  # DRep information and management card
├── proposals.tsx                  # Proposal discovery and listing
├── vote-card.tsx                  # Individual voting interface
├── ballot/
│   ├── ballot.tsx                 # Ballot creation and management
│   └── ballotOverview.tsx         # Ballot overview table component
├── proposal/
│   ├── index.tsx                  # Proposal detail page
│   ├── addBallot.tsx             # Add proposal to ballot functionality
│   └── voteButtton.tsx           # Vote button component
├── drep/
│   ├── drepForm.tsx              # DRep registration form
│   ├── drepMetadata.tsx          # DRep metadata handling
│   ├── registerDrep.tsx          # DRep registration logic
│   ├── retire.tsx                # DRep retirement functionality
│   └── updateDrep.tsx            # DRep update functionality
├── clarity/
│   ├── card-clarity.tsx          # Clarity integration card
│   └── create-clarity-action-page.tsx # Clarity action creation
├── cCommitee/
│   └── voteCC.tsx                # Constitutional Committee voting
└── README.md                     # This documentation
```

## Key Components

### Main Component (`index.tsx`)
- Orchestrates the entire governance page layout
- Manages floating ballot sidebar for mobile and desktop
- Integrates UTxO selector with governance operations
- Handles responsive design and mobile interactions
- Coordinates between all governance sub-components

### Card Info (`card-info.tsx`)
- Displays DRep ID, status, and voting power
- Provides quick access to DRep management actions
- Shows registration status and external links
- Manages DRep lifecycle (register, update, retire)

### Proposals (`proposals.tsx`)
- Fetches and displays all governance proposals
- Handles pagination and loading states
- Provides both desktop table and mobile card views
- Integrates with vote buttons for each proposal
- Manages proposal metadata and Markdown rendering

### Vote Card (`vote-card.tsx`)
- Individual voting interface for proposals
- Handles proposal ID input and validation
- Manages vote descriptions and metadata
- Integrates with ballot system for proposal grouping
- Provides direct voting functionality

### Ballot System (`ballot/ballot.tsx`)
- Complete ballot management system
- Creates and manages multiple ballots
- Handles proposal addition and removal
- Manages vote choices for each proposal
- Provides batch voting submission
- Includes ballot deletion and cleanup

### DRep Management (`drep/`)
- **Registration**: Complete DRep registration with metadata
- **Updates**: Modify DRep information and metadata
- **Retirement**: Proper DRep retirement process
- **Metadata**: Handle DRep metadata and anchor creation
- **Forms**: Comprehensive forms for all DRep operations

### Clarity Integration (`clarity/card-clarity.tsx`)
- Manages Clarity API key storage and validation
- Provides interface for creating governance actions
- Handles organization linking and status tracking
- Integrates with Clarity platform for advanced governance

## State Management

### Governance State
- `proposals`: Array of governance proposals with metadata
- `ballots`: Array of user-created ballots
- `selectedBallotId`: Currently selected ballot for operations
- `drepInfo`: DRep registration status and voting power
- `clarityApiKey`: Clarity platform integration key

### Voting State
- `voteKind`: Selected vote choice (Yes/No/Abstain)
- `proposalId`: Current proposal being voted on
- `ballotItems`: Proposals added to current ballot
- `ballotChoices`: Vote choices for each proposal in ballot
- `loading`: Loading states for voting operations

### UI State
- `manualUtxos`: Selected UTxOs for governance transactions
- `manualSelected`: Manual vs automatic UTxO selection mode
- `isMobile`: Mobile device detection for responsive behavior
- `sidebarOpen`: Floating ballot sidebar state
- `creating`: Ballot creation mode state

## UI Components Used

- **Radix UI**: Card, Button, Select, DropdownMenu, Dialog, Input, Textarea
- **Tailwind CSS**: Responsive design and styling
- **Lucide Icons**: Vote, Plus, MoreVertical, CheckCircle, Link2
- **Custom Components**: CardUI, SectionTitle, RowLabelInfo
- **Third-party Libraries**: 
  - **React Markdown**: Proposal content rendering
  - **Mesh SDK**: Cardano governance operations
  - **React Toast**: User notifications and feedback

## Responsive Breakpoints

- **Mobile**: `< 768px` - Floating ballot sidebar, card layouts
- **Tablet**: `768px - 1024px` - Hybrid layout with responsive tables
- **Desktop**: `≥ 1024px` - Full table layout with floating sidebar

## Governance Types

### DRep Operations
- **Registration**: Create DRep certificate with metadata anchor
- **Updates**: Modify DRep information and metadata
- **Retirement**: Retire DRep with proper certificate
- **Voting**: Submit votes on governance proposals

### Proposal Types
- **Constitution**: Constitutional amendment proposals
- **Parameter**: Protocol parameter change proposals
- **Hard Fork**: Hard fork initiation proposals
- **Info**: Informational proposals

### Vote Types
- **Yes**: Support the proposal
- **No**: Oppose the proposal
- **Abstain**: Neutral position on the proposal

## Ballot Management

### Ballot Creation
- Create named ballots for organizing multiple proposals
- Add proposals to ballots with individual vote choices
- Manage ballot lifecycle (create, update, delete)

### Ballot Operations
- **Add Proposal**: Add proposals to existing ballots
- **Remove Proposal**: Remove proposals from ballots
- **Update Choice**: Change vote choice for proposals
- **Batch Vote**: Submit all votes in a ballot simultaneously

### Ballot States
- **Empty**: Ballot with no proposals
- **Draft**: Ballot with proposals but not submitted
- **Submitted**: Ballot votes have been submitted to blockchain

## Clarity Integration

### API Management
- Store Clarity API keys securely
- Validate API key connectivity
- Manage organization associations

### Governance Actions
- Create complex governance actions through Clarity
- Link multisig wallets to Clarity organizations
- Track action status and results

## Accessibility

- **Keyboard Navigation**: Full keyboard support for all governance operations
- **Screen Readers**: Proper ARIA labels and semantic HTML structure
- **Focus Management**: Clear focus indicators and logical tab order
- **Color Contrast**: Sufficient contrast for all text and status indicators
- **Touch Targets**: Appropriately sized touch targets for mobile devices

## Error Handling

- **DRep Validation**: Ensures DRep registration before voting
- **Proposal Validation**: Validates proposal IDs and metadata
- **UTxO Validation**: Ensures sufficient funds for governance operations
- **Network Errors**: Handles blockchain connectivity issues
- **User Feedback**: Toast notifications for all user actions
- **Graceful Degradation**: Fallback UI when data is unavailable

## Performance

- **Lazy Loading**: Proposal data loaded on demand with pagination
- **Memoization**: Optimized re-renders with React.memo and useMemo
- **Efficient Fetching**: Parallel metadata loading for proposals
- **State Optimization**: Minimal state updates to prevent unnecessary re-renders
- **Mobile Optimization**: Efficient floating sidebar with proper event handling

## Security

- **DRep Validation**: Cryptographic verification of DRep certificates
- **Vote Integrity**: Ensures vote authenticity and non-repudiation
- **API Key Security**: Secure storage and handling of Clarity API keys
- **Transaction Validation**: Validates all governance transactions before submission
- **User Authentication**: Requires wallet connection for all governance operations

## Integration Points

### Blockchain Integration
- **Cardano Network**: Direct integration with Cardano governance
- **Blockfrost API**: Proposal and DRep data fetching
- **Mesh SDK**: Transaction building and signing

### External Services
- **Clarity Platform**: Advanced governance action creation
- **gov.tools**: DRep directory and information
- **Vercel Storage**: DRep metadata and anchor storage

### Internal Systems
- **Multisig Wallet**: Integration with multisig transaction system
- **UTxO Management**: Shared UTxO selection and management
- **Transaction System**: Unified transaction creation and signing

# Task Template

## 1. Task Overview
**Brief description of what needs to be built or implemented**

### Problem Statement
- What problem does this solve?
- Who is affected by this problem?
- What is the current state vs. desired state?

### Solution Overview
- High-level description of the proposed solution
- Key benefits and value proposition

## 2. Requirements

### User Stories
```
As a [user type], I want [functionality] so that [benefit/value]
```

### Functional Requirements
- **FR-1**: [Requirement description]
- **FR-2**: [Requirement description]
- **FR-3**: [Requirement description]

### Non-Functional Requirements
- **NFR-1**: [Performance, security, scalability requirements]
- **NFR-2**: [Usability, accessibility requirements]
- **NFR-3**: [Compatibility, integration requirements]

## 3. Technical Specifications

### Architecture Overview
- High-level system architecture
- Key components and their interactions

### API Specifications
- Endpoints and methods
- Request/response schemas
- Authentication and authorization

### Database Schema
- Entity relationships
- Key tables and fields
- Data migration requirements

### Integration Points
- External services/APIs
- Third-party dependencies
- Internal system integrations

## 4. Implementation Plan

### Development Phases
- **Phase 1**: [Scope and timeline]
- **Phase 2**: [Scope and timeline]
- **Phase 3**: [Scope and timeline]

### Dependencies
- External dependencies
- Internal team dependencies
- Infrastructure requirements

### Risk Assessment
- **High Risk**: [Risk description and mitigation]
- **Medium Risk**: [Risk description and mitigation]
- **Low Risk**: [Risk description and mitigation]

## 5. Testing Strategy

### Test Cases
- **TC-1**: [Test scenario and expected outcome]
- **TC-2**: [Test scenario and expected outcome]
- **TC-3**: [Test scenario and expected outcome]

### Testing Types
- Unit testing
- Integration testing
- End-to-end testing
- Performance testing
- Security testing

### Acceptance Criteria
- Definition of Done
- Quality gates
- Performance benchmarks

## 6. Code Analysis & Implementation Details

### Key Issues Identified
- **Issue 1**: [Description and location]
- **Issue 2**: [Description and location]
- **Issue 3**: [Description and location]

### Code References
- **Files to Modify**: [List of key files]
- **Authentication Integration**: [How to integrate with existing auth]
- **Frontend Integration**: [How to integrate with existing UI]

### Implementation Examples
```typescript
// Example code snippets for key implementations
export function exampleFunction() {
  // Implementation details
}
```

## 7. Next Steps
1. **Step 1**: [First action to take]
2. **Step 2**: [Second action to take]
3. **Step 3**: [Third action to take]

---

## Usage Instructions

1. **Fill in each section** with specific details for your task
2. **Remove sections** that are not applicable to your specific use case
3. **Add additional sections** as needed for your project
4. **Focus on implementation details** and code references
5. **Keep it concise** - this is for task explanation, not full PRD

## Developer IDE Workflow

### Getting Started with This Task

**For Developers using this task in their IDE:**

1. **Open the task** in your IDE alongside your code editor
   - Use split-screen or multiple tabs to keep the task visible while coding
   - Consider using IDE extensions for markdown preview if available

2. **Start with Requirements Analysis**
   - Read through the Functional Requirements (FR-1, FR-2, etc.)
   - Map each requirement to specific code modules/components
   - Create TODO comments in your code referencing requirement IDs

3. **Use the Technical Specifications Section**
   - Reference API specifications when implementing endpoints
   - Follow the database schema for data modeling
   - Use integration points to understand external dependencies

4. **Implement with User Stories in Mind**
   - Keep user stories visible while coding
   - Write code that directly addresses the "so that [benefit]" part
   - Test your implementation against the acceptance criteria

### IDE-Specific Tips

**VS Code Users:**
- Install "Markdown Preview Enhanced" extension for better task viewing
- Use "TODO Tree" extension to track requirements as TODOs in code
- Set up workspace with task and code side-by-side

**JetBrains IDEs (IntelliJ, WebStorm, etc.):**
- Use the built-in markdown preview
- Create TODO comments with requirement references: `// TODO: FR-1 - Implement user authentication`
- Use the TODO tool window to track progress

**Vim/Neovim Users:**
- Use markdown preview plugins like `markdown-preview.nvim`
- Set up split windows with task on one side, code on the other
- Use quickfix lists for TODO tracking

### Code Organization Strategy

1. **Create Feature Branches** based on task sections
   - `feature/user-authentication` (from FR-1)
   - `feature/api-integration` (from Technical Specifications)
   - `feature/ux-implementation` (from Requirements section)

2. **Use Commit Messages** that reference task sections
   ```
   feat: implement user authentication (FR-1)
   fix: resolve API integration issue (Technical Specs - API)
   test: add test cases for user journey (Testing Strategy - TC-1)
   ```

3. **Create Code Comments** linking back to task
   ```typescript
   /**
    * Implements FR-1: User Authentication
    * Supports user stories: "As a user, I want to log in securely"
    * Acceptance criteria: User can authenticate with valid credentials
    */
   export class AuthService {
     // Implementation here
   }
   ```

### Progress Tracking

1. **Mark Requirements as Complete**
   - Update the task with implementation status
   - Use checkboxes: `- [x] FR-1: User authentication (COMPLETED)`
   - Add implementation notes and code references

2. **Track Issues and Blockers**
   - Document any deviations from the task
   - Note technical constraints discovered during implementation
   - Update risk assessment based on actual development experience

3. **Regular Task Reviews**
   - Review task weekly during development
   - Update requirements based on new insights
   - Ensure code implementation aligns with documented requirements

### Integration with Development Tools

**Git Integration:**
- Link task sections to specific commits
- Use task requirements in pull request descriptions
- Reference task in code review comments

**Project Management:**
- Create tickets/tasks based on task sections
- Link development tasks to specific requirements
- Use task as source of truth for sprint planning

**Documentation:**
- Keep task updated as implementation progresses
- Add code examples and implementation details
- Document any architectural decisions made during development

## Notes
- This template should be customized based on your specific needs
- Consider the complexity and scope of your project when deciding which sections to include
- Regular reviews and updates are essential to keep the task current and useful
- **Keep the task as a living document** - update it as you learn more during development
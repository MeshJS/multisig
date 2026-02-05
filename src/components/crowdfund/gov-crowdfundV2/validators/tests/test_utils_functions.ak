use aiken/cbor
use cardano/address.{Script}
use cardano/assets.{Lovelace}
use cardano/governance.{
  GovernanceAction, NicePoll as GovNicePoll, NoConfidence, ProposalProcedure,
}
use gov.{VGovernanceAction, VNicePoll}
use mocktail.{mock_script_hash}
use utils.{check_proposal_procedure, compare_gov_action}

// Test constants
pub const mock_deposit: Lovelace = 50000000

pub const mock_return_address_credential = Script(mock_script_hash(0))

pub const mock_other_return_address_credential = Script(mock_script_hash(1))

pub const mock_other_deposit: Lovelace = 10000000

// compare_gov_action: validator decodes vgov as Plutus Data (same encoding as cbor.serialise)
// and compares structurally with governance_action_to_vgov(agov). Only NicePoll and TreasuryWithdrawal supported.

test compare_gov_action_matching_nice_poll() {
  let agov: GovernanceAction = GovNicePoll
  let vgov: VGovernanceAction = VNicePoll
  let vgov_bytes = cbor.serialise(vgov)
  compare_gov_action(agov, vgov_bytes)
}

test compare_gov_action_different_types() {
  let agov: GovernanceAction = NoConfidence { ancestor: None }
  let vgov: VGovernanceAction = VNicePoll
  let vgov_bytes = cbor.serialise(vgov)
  !compare_gov_action(agov, vgov_bytes)
}

// Test check_proposal_procedure function
test check_proposal_procedure_exact_match() {
  let proposal_procedure =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_return_address_credential,
      governance_action: GovNicePoll,
    }
  let proposal_procedures = [proposal_procedure]
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

test check_proposal_procedure_no_match_empty_list() {
  let proposal_procedures: List<ProposalProcedure> = []
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  !check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

test check_proposal_procedure_no_match_wrong_deposit() {
  let proposal_procedure =
    ProposalProcedure {
      deposit: mock_other_deposit,
      return_address: mock_return_address_credential,
      governance_action: GovNicePoll,
    }
  let proposal_procedures = [proposal_procedure]
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  !check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

test check_proposal_procedure_no_match_wrong_return_address() {
  let proposal_procedure =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_other_return_address_credential,
      governance_action: GovNicePoll,
    }
  let proposal_procedures = [proposal_procedure]
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  !check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

test check_proposal_procedure_no_match_wrong_governance_action() {
  let proposal_procedure =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_return_address_credential,
      governance_action: NoConfidence { ancestor: None },
    }
  let proposal_procedures = [proposal_procedure]
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  !check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

test check_proposal_procedure_multiple_matches() {
  let proposal_procedure1 =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_return_address_credential,
      governance_action: GovNicePoll,
    }
  let proposal_procedure2 =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_return_address_credential,
      governance_action: GovNicePoll,
    }
  let proposal_procedures = [proposal_procedure1, proposal_procedure2]
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  // Should return False because count == 2, not 1
  !check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

test check_proposal_procedure_one_match_among_multiple() {
  let matching_proposal =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_return_address_credential,
      governance_action: GovNicePoll,
    }
  let non_matching_proposal1 =
    ProposalProcedure {
      deposit: mock_other_deposit,
      return_address: mock_return_address_credential,
      governance_action: GovNicePoll,
    }
  let non_matching_proposal2 =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_other_return_address_credential,
      governance_action: GovNicePoll,
    }
  let proposal_procedures =
    [matching_proposal, non_matching_proposal1, non_matching_proposal2]
  let vgovernance_action: VGovernanceAction = VNicePoll
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

use aiken/cbor
use cardano/address.{Script}
use cardano/assets.{Lovelace}
use cardano/governance.{
  GovernanceAction, GovernanceActionId, NicePoll as GovNicePoll, NoConfidence,
  ProposalProcedure,
}
use gov.{VGovernanceAction, VNicePoll, VNoConfidence}
use mocktail.{mock_script_hash, mock_tx_hash}
use utils.{check_proposal_procedure, compare_gov_action}

// Test constants
pub const mock_deposit: Lovelace = 50000000

pub const mock_return_address_credential = Script(mock_script_hash(0))

pub const mock_other_return_address_credential = Script(mock_script_hash(1))

pub const mock_other_deposit: Lovelace = 10000000

pub const mock_ancestor_id =
  GovernanceActionId { transaction: mock_tx_hash(1), proposal_procedure: 0 }

// Test compare_gov_action function
test compare_gov_action_matching_no_confidence() {
  let agov: GovernanceAction = NoConfidence { ancestor: None }
  let vgov: VGovernanceAction = VNoConfidence { ancestor: None }
  let vgov_bytes = cbor.serialise(vgov)
  compare_gov_action(agov, vgov_bytes)
}

test compare_gov_action_matching_no_confidence_with_ancestor() {
  let agov: GovernanceAction = NoConfidence { ancestor: Some(mock_ancestor_id) }
  let vgov: VGovernanceAction =
    VNoConfidence { ancestor: Some(mock_ancestor_id) }
  let vgov_bytes = cbor.serialise(vgov)
  compare_gov_action(agov, vgov_bytes)
}

test compare_gov_action_non_matching_ancestor() {
  let agov: GovernanceAction = NoConfidence { ancestor: None }
  let vgov: VGovernanceAction =
    VNoConfidence { ancestor: Some(mock_ancestor_id) }
  let vgov_bytes = cbor.serialise(vgov)
  !compare_gov_action(agov, vgov_bytes)
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
      governance_action: NoConfidence { ancestor: Some(mock_ancestor_id) },
    }
  let proposal_procedures = [proposal_procedure]
  let vgovernance_action: VGovernanceAction = VNoConfidence { ancestor: None }
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

test check_proposal_procedure_with_ancestor_match() {
  let proposal_procedure =
    ProposalProcedure {
      deposit: mock_deposit,
      return_address: mock_return_address_credential,
      governance_action: NoConfidence { ancestor: Some(mock_ancestor_id) },
    }
  let proposal_procedures = [proposal_procedure]
  let vgovernance_action: VGovernanceAction =
    VNoConfidence { ancestor: Some(mock_ancestor_id) }
  let vgovernance_action_bytes = cbor.serialise(vgovernance_action)
  check_proposal_procedure(
    proposal_procedures,
    mock_deposit,
    mock_return_address_credential,
    vgovernance_action_bytes,
  )
}

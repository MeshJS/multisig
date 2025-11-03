use aiken/collection/list
use cardano/assets.{PolicyId}
use cardano/transaction.{Transaction}
use cardano/script_context.{ScriptContext}
use cocktail.{outputs_with_policy}

validator proxy(auth_token: PolicyId) {
  else(ctx: ScriptContext) {
    let Transaction { outputs, .. } = ctx.transaction
    let auth_tokens_in_outputs = outputs_with_policy(outputs, auth_token)
    list.length(auth_tokens_in_outputs) > 0
  }
}
// Standard model: the Credit sub-agent may also call gpt-5-mini.
@id("permit-credit-invoke-gpt5mini")
permit(
    principal == AppPolicies::Agent::"credit-agent",
    action == AppPolicies::Action::"invokeModel",
    resource == AppPolicies::Model::"gpt-5-mini"
);
